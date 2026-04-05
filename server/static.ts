import express, { type Express } from "express";
import fs from "fs";
import path from "path";

let preloadHeaders: string[] = [];

function buildPreloadHeaders(distPath: string) {
  const assetsDir = path.join(distPath, "assets");
  if (!fs.existsSync(assetsDir)) return;
  const files = fs.readdirSync(assetsDir);
  for (const file of files) {
    if (file.startsWith("index-") && file.endsWith(".css")) {
      preloadHeaders.push(`</assets/${file}>; rel=preload; as=style`);
    }
    if (file.startsWith("index-") && file.endsWith(".js") && !file.includes("chunk")) {
      preloadHeaders.push(`</assets/${file}>; rel=modulepreload`);
    }
  }
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  buildPreloadHeaders(distPath);

  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      maxAge: "1y",
      immutable: true,
    }),
  );

  app.use(
    express.static(distPath, {
      maxAge: "1h",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.endsWith("sw.js")) {
          // Service worker must always be fresh
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.endsWith("manifest.json")) {
          // PWA manifest must be fresh so updated names/icons apply immediately
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.endsWith(".js") && !filePath.includes("/assets/")) {
          // Non-hashed JS files in public root (e.g. audio-playback-worklet.js)
          // must not be stale-served after a deployment
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.match(/\.(png|jpg|jpeg|gif|ico|svg|webp)$/)) {
          res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400, immutable");
        } else if (filePath.match(/\.(woff2?|ttf|eot)$/)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.match(/\.(js|css)$/)) {
          res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
        }
      },
    }),
  );

  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    if (preloadHeaders.length > 0) {
      res.setHeader("Link", preloadHeaders.join(", "));
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
