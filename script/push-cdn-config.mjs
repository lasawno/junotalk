/**
 * push-cdn-config.mjs
 * Reads versioned config files from cdn-config/ and vault/config/
 * and mirrors them to lasawno/junotalk-cdn via the GitHub API.
 * Run by GitHub Actions on every push to main.
 */

import { readFile } from "fs/promises";
import { createHash } from "crypto";

const CDN_OWNER = "lasawno";
const CDN_REPO  = "junotalk-cdn";
const TOKEN     = process.env.CDN_GITHUB_TOKEN;

if (!TOKEN) {
  console.error("❌  CDN_GITHUB_TOKEN is not set — skipping CDN sync.");
  process.exit(1);
}

const FILES = [
  { src: "cdn-config/auth-policy.json",       dest: "config/auth-policy.json" },
  { src: "cdn-config/client-config.json",     dest: "config/client-config.json" },
  { src: "vault/config/carousel-feed.json",   dest: "config/carousel-feed.json" },
];

async function githubRequest(method, path, body) {
  const url = `https://api.github.com/repos/${CDN_OWNER}/${CDN_REPO}/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.status === 404 ? null : res.json();
}

async function pushFile(src, dest) {
  const raw = await readFile(src, "utf-8");

  // Strip _comment fields before uploading — keep the CDN payload clean
  const parsed = JSON.parse(raw);
  delete parsed._comment;
  const content = JSON.stringify(parsed, null, 2) + "\n";
  const encoded = Buffer.from(content).toString("base64");

  // Check if the file already exists so we can include its SHA (required for updates)
  const existing = await githubRequest("GET", `contents/${dest}`);
  const sha = existing?.sha;

  // Skip upload if content hasn't changed
  if (sha) {
    const remoteContent = Buffer.from(existing.content.replace(/\n/g, ""), "base64").toString("utf-8");
    if (remoteContent === content) {
      console.log(`✓  ${dest}  (unchanged, skipped)`);
      return;
    }
  }

  await githubRequest("PUT", `contents/${dest}`, {
    message: `chore: sync ${dest} from main [skip ci]`,
    content: encoded,
    ...(sha ? { sha } : {}),
  });

  console.log(`✅  ${dest}  (${sha ? "updated" : "created"})`);
}

(async () => {
  let failed = 0;
  for (const { src, dest } of FILES) {
    try {
      await pushFile(src, dest);
    } catch (err) {
      console.error(`❌  ${dest}: ${err.message}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} file(s) failed to sync.`);
    process.exit(1);
  }
  console.log("\nCDN config sync complete.");
})();
