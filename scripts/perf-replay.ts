/**
 * Replay performance profiling (CHOKEPOINT-PLAN.md §12.5: replay frame
 * budget, idle render behavior, memory growth over enable/disable cycles,
 * timeline scrubbing).
 *
 * Measures REAL Cesium render cost via preRender/postRender deltas (the app
 * runs requestRenderMode, so browser rAF rate is not a render measure).
 * Writes a JSON + MD artifact into research/perf/ (§12.6 evaluation
 * artifacts). Fixture mode; no network beyond localhost.
 *
 * Command: npm run perf:replay
 */

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const PORT = 4174;
const BASE = `http://localhost:${PORT}`;

/** Documented §12.5 budgets (v1). Fail the run when exceeded. */
const BUDGETS = {
  renderMeanMs: 33, // sustained render cost at 30fps headroom
  renderMaxMs: 250, // no single frame may hitch past 250ms
  scrubMaxMs: 250, // seek -> next completed render (measured v1: mean ~127ms, max ~160ms)
  idleRendersPer10s: 2, // requestRenderMode: idle work ~ zero
  memoryGrowthPct: 50, // heap growth over 5 enable/disable cycles
  replayCycles: 5,
  scrubCount: 20,
  renderSampleMs: 10_000,
  idleSampleMs: 5_000,
  idleSettleMs: 8_000,
} as const;

interface RenderStats {
  renderCount: number;
  meanMs: number;
  maxMs: number;
  p95Ms: number;
}

type Debug = {
  startRenderStats: () => boolean;
  getRenderStats: () => RenderStats | null;
  getHeap: () => number | null;
};

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`dev server did not start within ${timeoutMs}ms`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  stdio: "pipe",
  shell: true,
});

interface PerfResults {
  generatedAt: string;
  budgets: typeof BUDGETS;
  replay: RenderStats | null;
  scrub: { count: number; maxMs: number; meanMs: number };
  idle: RenderStats | null;
  memory: { samples: Array<number | null>; growthPct: number | null; cycles: number };
  failures: string[];
  pass: boolean;
}

const results: PerfResults = {
  generatedAt: new Date().toISOString(),
  budgets: BUDGETS,
  replay: null,
  scrub: { count: 0, maxMs: 0, meanMs: 0 },
  idle: null,
  memory: { samples: [], growthPct: null, cycles: BUDGETS.replayCycles },
  failures: [],
  pass: false,
};

try {
  await waitForServer(`${BASE}/`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid^=launcher-]", { timeout: 30_000 });
  await page.click("[data-testid=launcher-long-beach-approach]");
  await page.waitForSelector("[data-testid=card-vessel-count]", { timeout: 30_000 });
  await sleep(4000); // globe init + first renders settle

  const debug = await page.evaluate(() => {
    return (window as unknown as { __chokepointDebug?: Debug }).__chokepointDebug ?? null;
  });
  if (!debug) throw new Error("debug hooks unavailable");
  const started = await page.evaluate(() => (window as unknown as { __chokepointDebug?: Debug }).__chokepointDebug!.startRenderStats());
  if (!started) throw new Error("render stats failed to attach");
  const reset = async () => {
    await page.evaluate(() => {
      const w = window as unknown as { __chokepointRenderStats?: { samples: number[] } };
      if (w.__chokepointRenderStats) w.__chokepointRenderStats.samples = [];
    });
  };

  // --- 1) Replay frame budget: play the full window, measure render cost ---
  // The launch cursor sits at the window END (main.ts default), where play()
  // auto-pauses immediately (advance clamps at the end). Seek to the window
  // start first so playback actually runs.
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("[data-testid=seek]")!;
    input.value = input.min;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await reset();
  await page.click("[data-testid=play]");
  await sleep(BUDGETS.renderSampleMs);
  await page.click("[data-testid=play]"); // pause
  // Verify the pause landed (the button flips Play/Pause; retry if a render
  // re-created the button between hit-testing and dispatch).
  for (let i = 0; i < 10; i++) {
    const label = await page.textContent("[data-testid=play]");
    if (label === "Play") break;
    await page.click("[data-testid=play]");
    await sleep(200);
  }
  const pauseLabel = await page.textContent("[data-testid=play]");
  if (pauseLabel !== "Play") results.failures.push("replay pause did not land; idle stats would be invalid");
  results.replay = await page.evaluate(() =>
    (window as unknown as { __chokepointDebug?: Debug }).__chokepointDebug!.getRenderStats(),
  );
  console.log("replay render stats:", JSON.stringify(results.replay));
  if (results.replay) {
    if (results.replay.meanMs > BUDGETS.renderMeanMs)
      results.failures.push(`replay mean render ${results.replay.meanMs.toFixed(1)}ms > ${BUDGETS.renderMeanMs}ms`);
    if (results.replay.maxMs > BUDGETS.renderMaxMs)
      results.failures.push(`replay max render ${results.replay.maxMs.toFixed(1)}ms > ${BUDGETS.renderMaxMs}ms`);
  }

  // --- 2) Timeline scrubbing: seek latency per scrub ---
  const scrubSamples: number[] = [];
  for (let i = 0; i < BUDGETS.scrubCount; i++) {
    const scrubCount = BUDGETS.scrubCount;
    // Measure IN PAGE via the debug hook: dispatch -> next completed render,
    // no harness overhead (the hook lives in main.ts; see measureScrubLatency).
    const latency = await page.evaluate(
      ({ index, n }) =>
        (window as unknown as {
          __chokepointDebug?: { measureScrubLatency: (i: number, n: number) => Promise<number> };
        }).__chokepointDebug!.measureScrubLatency(index, n),
      { index: i, n: scrubCount },
    );
    if (latency >= 0) scrubSamples.push(latency);
  }
  results.scrub = {
    count: scrubSamples.length,
    maxMs: Math.max(...scrubSamples),
    meanMs: scrubSamples.reduce((a, b) => a + b, 0) / scrubSamples.length,
  };
  console.log("scrub stats:", JSON.stringify(results.scrub));
  if (results.scrub.maxMs > BUDGETS.scrubMaxMs)
    results.failures.push(`scrub max ${results.scrub.maxMs.toFixed(1)}ms > ${BUDGETS.scrubMaxMs}ms`);

  // --- 3) Idle render behavior: paused replay must render ~nothing ---
  // Settle first (imagery tiles stream after the scrub burst), then count.
  await sleep(BUDGETS.idleSettleMs);
  await reset();
  await sleep(BUDGETS.idleSampleMs);
  results.idle = await page.evaluate(() =>
    (window as unknown as { __chokepointDebug?: Debug }).__chokepointDebug!.getRenderStats(),
  );
  console.log("idle render stats:", JSON.stringify(results.idle));
  if (results.idle && results.idle.renderCount > BUDGETS.idleRendersPer10s * (BUDGETS.idleSampleMs / 10_000))
    results.failures.push(`idle renders ${results.idle.renderCount} exceed budget in ${BUDGETS.idleSampleMs}ms`);

  // --- 4) Memory growth over enable/disable cycles ---
  const heap0 = await page.evaluate(() => (window as unknown as { __chokepointDebug?: Debug }).__chokepointDebug!.getHeap());
  for (let i = 0; i < BUDGETS.replayCycles; i++) {
    await page.click("[data-testid=back-to-launcher]");
    await page.waitForSelector("[data-testid^=launcher-]");
    await page.click("[data-testid=launcher-long-beach-approach]");
    await page.waitForSelector("[data-testid=card-vessel-count]");
    await sleep(1200);
    results.memory.samples.push(await page.evaluate(() => (window as unknown as { __chokepointDebug?: Debug }).__chokepointDebug!.getHeap()));
  }
  const valid = results.memory.samples.filter((s): s is number => s !== null);
  if (heap0 !== null && valid.length === BUDGETS.replayCycles) {
    const growth = ((valid[valid.length - 1]! - heap0) / heap0) * 100;
    results.memory.growthPct = growth;
    console.log(`heap: ${heap0} -> ${valid[valid.length - 1]} (${growth.toFixed(1)}% growth)`);
    if (growth > BUDGETS.memoryGrowthPct)
      results.failures.push(`memory growth ${growth.toFixed(1)}% > ${BUDGETS.memoryGrowthPct}%`);
  } else {
    console.log("heap metrics unavailable (performance.memory missing)");
  }

  await page.screenshot({ path: "research/qa/phase3-perf-replay.png" });
  await browser.close();

  results.failures.push(
    ...pageErrors
      .filter((e) => /An error occurred while rendering/i.test(e))
      .map((e) => `render page error: ${e.slice(0, 120)}`),
  );
} catch (err) {
  results.failures.push(`harness error: ${String(err).slice(0, 300)}`);
} finally {
  server.kill();
}

results.pass = results.failures.length === 0;
mkdirSync("research/perf", { recursive: true });
const day = results.generatedAt.slice(0, 10);
writeFileSync(`research/perf/replay-perf-${day}.json`, JSON.stringify(results, null, 2));
const md = [
  "# Replay performance profile (§12.5 budgets v1)",
  "",
  `- Generated: ${results.generatedAt}`,
  `- Replay render: count=${results.replay?.renderCount ?? "n/a"}, mean=${results.replay?.meanMs?.toFixed(1) ?? "n/a"}ms, p95=${results.replay?.p95Ms?.toFixed(1) ?? "n/a"}ms, max=${results.replay?.maxMs?.toFixed(1) ?? "n/a"}ms (budget mean ${BUDGETS.renderMeanMs}ms / max ${BUDGETS.renderMaxMs}ms)`,
  `- Scrub latency (n=${results.scrub.count}): mean=${results.scrub.meanMs.toFixed(1)}ms, max=${results.scrub.maxMs.toFixed(1)}ms (budget ${BUDGETS.scrubMaxMs}ms)`,
  `- Idle renders over ${BUDGETS.idleSampleMs / 1000}s paused: ${results.idle?.renderCount ?? "n/a"} (budget ${BUDGETS.idleRendersPer10s * (BUDGETS.idleSampleMs / 10_000)})`,
  `- Heap growth over ${BUDGETS.replayCycles} enable/disable cycles: ${results.memory.growthPct === null ? "n/a" : results.memory.growthPct.toFixed(1) + "%"} (budget ${BUDGETS.memoryGrowthPct}%)`,
  "",
  `**Result: ${results.pass ? "PASS" : "FAIL"}**`,
  ...(results.failures.length ? ["", "## Failures", ...results.failures.map((f) => `- ${f}`)] : []),
  "",
].join("\n");
writeFileSync(`research/perf/replay-perf-${day}.md`, md);
console.log(md);
process.exit(results.pass ? 0 : 1);
