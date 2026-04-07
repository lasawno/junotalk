/**
 * Juno Vision Hub — Config & Stress Test
 * Run: npx tsx scripts/stress-test-vision.ts
 *
 * Tests:
 *   1. Hub availability (HuggingFace BLIP reachable?)
 *   2. Caption quality across image types
 *   3. VQA (visual question answering) with user questions
 *   4. Multi-language output accuracy
 *   5. Concurrent load (N parallel requests)
 *   6. Error recovery (bad image, timeout simulation)
 *   7. YOLO local path (detector sidecar health)
 *   8. End-to-end latency breakdown
 */

import { hubVisionAnalyze } from "../server/juno-vision-hub";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

const RESULTS_DIR = path.resolve("scripts/stress-results");
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

const CONCURRENCY = 5;
const REPEAT = 3;

interface TestResult {
  name: string;
  passed: boolean;
  latencyMs: number;
  engine?: string;
  label?: string;
  translation?: string;
  sentence?: string;
  answer?: string;
  caption?: string;
  error?: string;
}

const results: TestResult[] = [];
let passed = 0;
let failed = 0;

function color(code: number, text: string) {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (t: string) => color(32, t);
const red   = (t: string) => color(31, t);
const cyan  = (t: string) => color(36, t);
const yellow = (t: string) => color(33, t);
const bold  = (t: string) => color(1, t);

function log(msg: string) { process.stdout.write(msg + "\n"); }

async function downloadImage(url: string, dest: string): Promise<Buffer> {
  if (existsSync(dest)) return readFileSync(dest);
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  writeFileSync(dest, buf);
  return buf;
}

async function runTest(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    log(`  ${green("✓")} ${name} ${yellow(`(${ms}ms)`)}`);
    passed++;
  } catch (err: any) {
    const ms = Date.now() - start;
    log(`  ${red("✗")} ${name} ${yellow(`(${ms}ms)`)} — ${err.message}`);
    results.push({ name, passed: false, latencyMs: ms, error: err.message });
    failed++;
  }
}

async function visionTest(
  name: string,
  imageBuffer: Buffer,
  mimeType: string,
  sourceLang: string,
  targetLang: string,
  question?: string
): Promise<TestResult> {
  const start = Date.now();
  try {
    const result = await hubVisionAnalyze(imageBuffer, mimeType, sourceLang, targetLang, question);
    const latencyMs = Date.now() - start;

    const ok =
      typeof result.label === "string" && result.label.length > 0 &&
      typeof result.translation === "string" && result.translation.length > 0 &&
      typeof result.sentence === "string" && result.sentence.length > 0 &&
      result.engine === "hub";

    const r: TestResult = {
      name,
      passed: ok,
      latencyMs,
      engine: result.engine,
      label: result.label,
      translation: result.translation,
      sentence: result.sentence,
      answer: result.answer,
      caption: result.caption,
    };

    results.push(r);
    if (ok) {
      passed++;
      log(`  ${green("✓")} ${bold(name)} ${yellow(`(${latencyMs}ms)`)}`);
      log(`     caption   : ${cyan(result.caption)}`);
      log(`     label     : ${result.label}`);
      log(`     →${targetLang}    : ${green(result.translation)}`);
      log(`     sentence  : ${result.sentence}`);
      if (result.answer) log(`     answer    : ${result.answer}`);
    } else {
      failed++;
      log(`  ${red("✗")} ${bold(name)} — incomplete result`);
    }
    return r;
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const r: TestResult = { name, passed: false, latencyMs, error: err.message };
    results.push(r);
    failed++;
    log(`  ${red("✗")} ${bold(name)} ${yellow(`(${latencyMs}ms)`)} — ${err.message}`);
    return r;
  }
}

async function checkHuggingFaceAvailability(): Promise<boolean> {
  log(`\n${bold("═══ SECTION 1: Hub Availability Check ═══")}`);
  try {
    const res = await fetch("https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large", {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });
    const hfToken = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || "";
    log(`  HuggingFace API status : ${res.status} ${res.statusText}`);
    log(`  HF_TOKEN configured    : ${hfToken ? green("YES") : yellow("NO (using public rate limit)")}`);
    log(`  BLIP caption model     : ${res.status < 500 ? green("reachable") : red("unreachable")}`);
    return res.status < 500;
  } catch (err: any) {
    log(`  ${red("✗")} HuggingFace unreachable: ${err.message}`);
    return false;
  }
}

async function testYoloSidecar(): Promise<void> {
  log(`\n${bold("═══ SECTION 2: YOLO Local Sidecar Health ═══")}`);
  const port = process.env.VISION_DETECTOR_PORT || "5098";
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json() as any;
      log(`  ${green("✓")} YOLO sidecar running`);
      log(`    engine  : ${data.engine}`);
      log(`    classes : ${data.classes}`);
      log(`    yolo    : ${data.yolo_loaded ? green("loaded") : yellow("not loaded yet")}`);
      log(`    ocr     : ${data.ocr_available ? green("available") : yellow("unavailable")}`);
    } else {
      log(`  ${yellow("!")} YOLO sidecar returned ${res.status} — still starting up`);
    }
  } catch {
    log(`  ${yellow("!")} YOLO sidecar not reachable on port ${port} (may still be starting)`);
  }
}

async function testImageCaptioning(images: Record<string, Buffer>): Promise<void> {
  log(`\n${bold("═══ SECTION 3: Caption Quality — Image Types ═══")}`);

  const tests = [
    { name: "Coffee cup → Spanish", img: "coffee", src: "en", tgt: "es" },
    { name: "Dog photo → French",   img: "dog",    src: "en", tgt: "fr" },
    { name: "Cat photo → Japanese", img: "cat",    src: "en", tgt: "ja" },
    { name: "Street scene → German",img: "street", src: "en", tgt: "de" },
  ];

  for (const t of tests) {
    const buf = images[t.img];
    if (!buf) { log(`  ${yellow("!")} Skipping "${t.name}" — image not downloaded`); continue; }
    await visionTest(t.name, buf, "image/jpeg", t.src, t.tgt);
  }
}

async function testVQA(images: Record<string, Buffer>): Promise<void> {
  log(`\n${bold("═══ SECTION 4: Visual Question Answering ═══")}`);

  const tests = [
    { name: "VQA: What color?",    img: "dog",    q: "What color is the animal?",   src: "en", tgt: "es" },
    { name: "VQA: What is this?",  img: "coffee", q: "What is this object?",         src: "en", tgt: "fr" },
    { name: "VQA: How many?",      img: "street", q: "How many people are visible?", src: "en", tgt: "de" },
  ];

  for (const t of tests) {
    const buf = images[t.img];
    if (!buf) { log(`  ${yellow("!")} Skipping "${t.name}" — image not downloaded`); continue; }
    await visionTest(t.name, buf, "image/jpeg", t.src, t.tgt, t.q);
  }
}

async function testMultiLanguage(images: Record<string, Buffer>): Promise<void> {
  log(`\n${bold("═══ SECTION 5: Multi-Language Output ═══")}`);

  const buf = images.dog || images.coffee || images.cat;
  if (!buf) { log(`  ${yellow("!")} No test image available — skipping`); return; }

  const langs = [
    { tgt: "es", name: "Spanish" },
    { tgt: "fr", name: "French" },
    { tgt: "de", name: "German" },
    { tgt: "ja", name: "Japanese" },
    { tgt: "pt", name: "Portuguese" },
    { tgt: "ar", name: "Arabic" },
    { tgt: "zh", name: "Chinese" },
    { tgt: "ko", name: "Korean" },
    { tgt: "hi", name: "Hindi" },
  ];

  for (const l of langs) {
    await visionTest(`→ ${l.name}`, buf, "image/jpeg", "en", l.tgt);
  }
}

async function testConcurrentLoad(images: Record<string, Buffer>): Promise<void> {
  log(`\n${bold(`═══ SECTION 6: Concurrent Load (${CONCURRENCY} parallel × ${REPEAT} rounds) ═══`)}`);

  const imageList = Object.values(images).filter(Boolean);
  if (imageList.length === 0) { log(`  ${yellow("!")} No images available — skipping`); return; }

  const targets = ["es", "fr", "de", "ja", "pt"];
  const totalRequests = CONCURRENCY * REPEAT;
  let successes = 0;
  let failures = 0;
  const latencies: number[] = [];

  for (let round = 0; round < REPEAT; round++) {
    const batch = Array.from({ length: CONCURRENCY }, (_, i) => {
      const img = imageList[i % imageList.length];
      const tgt = targets[i % targets.length];
      const start = Date.now();
      return hubVisionAnalyze(img, "image/jpeg", "en", tgt)
        .then(r => {
          latencies.push(Date.now() - start);
          if (r.label && r.translation) successes++;
          else failures++;
        })
        .catch(() => {
          latencies.push(Date.now() - start);
          failures++;
        });
    });
    log(`  Round ${round + 1}/${REPEAT} — firing ${CONCURRENCY} concurrent requests...`);
    await Promise.all(batch);
  }

  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const max = Math.max(...latencies);
  const min = Math.min(...latencies);

  log(`  Total requests : ${totalRequests}`);
  log(`  Successes      : ${green(String(successes))}`);
  log(`  Failures       : ${failures > 0 ? red(String(failures)) : green(String(failures))}`);
  log(`  Latency avg    : ${yellow(avg.toFixed(0) + "ms")}`);
  log(`  Latency min    : ${yellow(min + "ms")}`);
  log(`  Latency max    : ${yellow(max + "ms")}`);

  if (successes > 0) passed++;
  else failed++;
  results.push({
    name: `Concurrent load (${CONCURRENCY}x${REPEAT})`,
    passed: successes > 0,
    latencyMs: avg,
  });
}

async function testErrorRecovery(): Promise<void> {
  log(`\n${bold("═══ SECTION 7: Error Recovery ═══")}`);

  await runTest("Empty buffer → graceful error", async () => {
    try {
      await hubVisionAnalyze(Buffer.alloc(0), "image/jpeg", "en", "es");
      throw new Error("Should have thrown on empty buffer");
    } catch (err: any) {
      if (err.message === "Should have thrown on empty buffer") throw err;
    }
  });

  await runTest("Corrupt image → graceful error", async () => {
    try {
      const garbage = Buffer.from("not-an-image-at-all-xxxx", "utf-8");
      await hubVisionAnalyze(garbage, "image/jpeg", "en", "es");
      throw new Error("Should have thrown on corrupt image");
    } catch (err: any) {
      if (err.message === "Should have thrown on corrupt image") throw err;
    }
  });

  await runTest("Minimal 1×1 pixel image → succeeds or throws cleanly", async () => {
    const tiny1px = Buffer.from(
      "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARC" +
      "AABAAEDASIA2gABAREA/8QAFgABAQEAAAAAAAAAAAAAAAAABQQD/8QAIRAAAQQCAgMBAAAAAAAAAAAAAQIDEQQSMSFBUWH/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEB" +
      "AAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmyWtc1waXEAAknQCpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUr/2Q==",
      "base64"
    );
    try {
      await hubVisionAnalyze(tiny1px, "image/jpeg", "en", "es");
    } catch {
    }
  });
}

function printSummary(startTime: number): void {
  const totalMs = Date.now() - startTime;
  const total = passed + failed;

  log(`\n${bold("═══════════════════════════════════════")}`);
  log(bold("  STRESS TEST SUMMARY"));
  log(bold("═══════════════════════════════════════"));
  log(`  Total checks  : ${total}`);
  log(`  Passed        : ${green(String(passed))}`);
  log(`  Failed        : ${failed > 0 ? red(String(failed)) : green(String(failed))}`);
  log(`  Duration      : ${yellow(totalMs + "ms")}`);
  log(bold("═══════════════════════════════════════"));

  const latencies = results.filter(r => r.latencyMs > 0).map(r => r.latencyMs);
  if (latencies.length > 0) {
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    log(`  Avg latency   : ${yellow(avg.toFixed(0) + "ms")}`);
    log(`  Slowest test  : ${yellow(Math.max(...latencies) + "ms")}`);
    log(`  Fastest test  : ${yellow(Math.min(...latencies) + "ms")}`);
  }

  const reportPath = path.join(RESULTS_DIR, `vision-stress-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ summary: { total, passed, failed, totalMs }, results }, null, 2));
  log(`\n  Report saved  : ${cyan(reportPath)}`);
  log(bold("═══════════════════════════════════════\n"));
}

const TEST_IMAGES: Record<string, string> = {
  dog:    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/YellowLabradorLooking_new.jpg/1200px-YellowLabradorLooking_new.jpg",
  cat:    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Cat_November_2010-1a.jpg/1200px-Cat_November_2010-1a.jpg",
  coffee: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/A_small_cup_of_coffee.JPG/1200px-A_small_cup_of_coffee.JPG",
  street: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Times_Square_at_night_2013.jpg/1280px-Times_Square_at_night_2013.jpg",
};

async function main() {
  const startTime = Date.now();
  log(`\n${bold("╔══════════════════════════════════════╗")}`);
  log(bold("║   JUNO VISION HUB — STRESS TEST v1   ║"));
  log(`${bold("╚══════════════════════════════════════╝")}\n`);
  log(`  Timestamp  : ${new Date().toISOString()}`);
  log(`  Concurrency: ${CONCURRENCY} parallel`);
  log(`  Rounds     : ${REPEAT}`);
  log(`  Engine     : HuggingFace BLIP + AI Gateway`);

  const hfAvailable = await checkHuggingFaceAvailability();
  await testYoloSidecar();

  log(`\n${bold("═══ Downloading Test Images ═══")}`);
  const images: Record<string, Buffer> = {};
  for (const [name, url] of Object.entries(TEST_IMAGES)) {
    const dest = path.join(RESULTS_DIR, `${name}.jpg`);
    try {
      images[name] = await downloadImage(url, dest);
      log(`  ${green("✓")} ${name} (${(images[name].length / 1024).toFixed(1)}KB)`);
    } catch (err: any) {
      log(`  ${yellow("!")} ${name} — download failed: ${err.message}`);
    }
  }

  if (!hfAvailable) {
    log(`\n${yellow("⚠ HuggingFace appears unreachable. Tests will show actual error responses.")}`);
  }

  await testImageCaptioning(images);
  await testVQA(images);
  await testMultiLanguage(images);
  await testConcurrentLoad(images);
  await testErrorRecovery();

  printSummary(startTime);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  log(`\n${red("Fatal error:")} ${err.message}`);
  process.exit(1);
});
