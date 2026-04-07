import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, cp, mkdir } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "@upstash/redis",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "ioredis",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));
  if (!externals.includes("playwright")) externals.push("playwright");

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  try {
    await mkdir("dist/wasm-codegen", { recursive: true });
    await cp("server/wasm-codegen", "dist/wasm-codegen", { recursive: true });
  } catch {}

  try {
    await mkdir("dist/vision-data", { recursive: true });
    await cp("server/vision-data", "dist/vision-data", { recursive: true });
  } catch {}

  const pythonFiles = [
    "server/vision-detector.py",
    "server/piper-tts-server.py",
    "server/whisper-sidecar.py",
    "server/edge-tts-sidecar.py",
  ];
  for (const f of pythonFiles) {
    try {
      const name = f.split("/").pop()!;
      await cp(f, `dist/${name}`);
    } catch {}
  }

  // piper-models are downloaded at runtime to /tmp — not bundled in deployment image
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
