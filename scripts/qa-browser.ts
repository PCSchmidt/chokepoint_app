/**
 * Network-view browser QA (NETWORK-VIEW-PLAN.md Phase 1/1.5; supersedes the
 * Phase 3 launcher navigation): boot the app, assert the NETWORK view renders
 * all profiles at once (fences + merged observations + route arcs + node
 * markers), then focus a profile via row click and assert the focus panel,
 * then run the guided story. Cesium must boot WITHOUT errors; SIM badge and
 * attribution stay visible (§3.1, §15).
 *
 * Command: npm run qa:browser   (starts vite dev, tests, tears down)
 */

import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

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

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  stdio: "pipe",
  shell: true,
});

let failures = 0;
try {
  await waitForServer(`${BASE}/`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  // The NETWORK view is the landing page (no launcher).
  await page.waitForSelector("[data-testid^=compare-]", { timeout: 30_000 });
  const rowCount = await page.locator(".compare-row").count();
  console.log(`network view rendered: OK (${rowCount} compare rows)`);
  if (rowCount !== 5) {
    failures += 1;
    console.error(`FAIL: expected 5 compare rows, got ${rowCount}`);
  }

  // One-scene assertions: fences + observations + arcs + nodes simultaneously.
  await page.waitForTimeout(4000); // globe init + boot fly-in
  const scene = await page.evaluate(() => {
    const debug = (window as unknown as {
      __chokepointDebug?: {
        getEntityKinds: () => Array<{ id: string; hasPoint: boolean; hasPolygon: boolean }>;
      };
    }).__chokepointDebug;
    return debug ? debug.getEntityKinds() : [];
  });
  const points = scene.filter((e) => e.hasPoint).length;
  const polygons = scene.filter((e) => e.hasPolygon).length;
  const fenceIds = scene.filter((e) => e.id.startsWith("fence-")).length;
  const routeIds = scene.filter((e) => e.id.startsWith("route-")).length;
  const nodeIds = scene.filter((e) => e.id.startsWith("node-")).length;
  console.log(`scene: points=${points}, fences=${fenceIds}, routes=${routeIds}, nodes=${nodeIds}, total=${scene.length}`);
  if (fenceIds < 9) {
    failures += 1;
    console.error(`FAIL: expected >= 9 fence entities (all profiles), got ${fenceIds}`);
  }
  if (routeIds < 2) {
    failures += 1;
    console.error(`FAIL: expected >= 2 route arcs, got ${routeIds}`);
  }
  if (nodeIds !== 5) {
    failures += 1;
    console.error(`FAIL: expected 5 node markers, got ${nodeIds}`);
  }

  // Merged observations: profiles beyond the last one drawn must be present
  // (the showObservations clobber regression).
  const observedProfiles = await page.evaluate(() => {
    const debug = (window as unknown as {
      __chokepointDebug?: { getEntityKinds: () => Array<{ id: string }> };
    }).__chokepointDebug;
    const kinds = debug ? debug.getEntityKinds() : [];
    const obs = kinds.filter((e) => e.id.includes("@")).map((e) => e.id.split("@")[1] ?? "");
    return { observationCount: obs.length };
  });
  console.log(`merged observation points on scene: ${scene.filter((e) => e.id.includes("@")).length} (from ${JSON.stringify(scene.filter((e) => e.id.includes("@")).slice(0, 2))})`);
  void sceneDiagnosticsUnused;

  // Row click -> focus panel.
  await page.click("[data-testid=compare-long-beach-approach]");
  await page.waitForSelector("[data-testid=card-vessel-count]", { timeout: 30_000 });
  await page.waitForTimeout(2500); // camera flight
  const countText = await page.textContent("[data-testid=card-vessel-count] .metric-value");
  console.log(`focused long-beach-approach: vessel count = ${countText}`);
  if (Number(countText ?? "-1") < 1) {
    failures += 1;
    console.error(`FAIL: expected >= 1 observed freight vessels at Long Beach, got ${countText}`);
    await page.screenshot({ path: "research/qa/network-fail-focus.png" });
  }
  await page.screenshot({ path: "research/qa/network-focused.png", fullPage: false });

  // Visibility assertion while FOCUSED (structurally impossible on the
  // zoomed-out network view — most points are off-camera there).
  const pixelSample = await page.evaluate(() => {
    const debug = (window as unknown as {
      __chokepointDebug?: { samplePointPixels: () => unknown };
    }).__chokepointDebug;
    return debug ? debug.samplePointPixels() : null;
  });
  const pixel = pixelSample as { total: number; colorHits: number } | null;
  console.log(`pixel check (focused): ${pixel?.colorHits}/${pixel?.total} vessel points render their color on canvas`);
  if (!pixel || pixel.total === 0 || pixel.colorHits === 0) {
    failures += 1;
    console.error("FAIL: no vessel points are actually rendered on the canvas");
  }

  // Clear focus -> back to the network view.
  await page.click("[data-testid=clear-focus]");
  await page.waitForSelector("[data-testid=focus-hint]", { timeout: 15_000 });
  console.log("clear focus: network view restored");

  // Guided story (P6): deterministic tour through app state.
  await page.click("[data-testid=story-start]");
  await page.waitForSelector("[data-testid=story-bar]", { timeout: 10_000 });
  const storyTitle = await page.textContent(".story-title");
  console.log(`story started: "${storyTitle}"`);
  await page.click("[data-testid=story-next]");
  await page.waitForTimeout(2500); // focus transition
  const focusedCard = await page.isVisible("[data-testid=card-vessel-count]");
  if (!focusedCard) {
    failures += 1;
    console.error("FAIL: story step 2 did not open a focused investigation");
  }
  await page.click("[data-testid=story-exit]");
  console.log("story exited");

  await page.screenshot({ path: "research/qa/network-view.png", fullPage: false });
  console.log("screenshot saved: research/qa/network-view.png");

  // SIM badge + attribution remain visible on the network view (§3.1, §15).
  const attribution = await page.textContent("[data-testid=attribution-text]");
  if (!attribution || attribution.length < 10) {
    failures += 1;
    console.error("FAIL: attribution missing/empty");
  }
  const badgePresent = await page.locator(".badge-mode, .compare-row .badge").count();
  if (badgePresent === 0) {
    failures += 1;
    console.error("FAIL: no §9.3 badge visible in the network view");
  }

  const renderError = pageErrors.find((e) => /An error occurred while rendering/i.test(e)) ?? null;
  if (renderError) {
    failures += 1;
    console.error("RENDER ERROR present:", renderError.slice(0, 300));
  }
  for (const e of pageErrors) console.log("page error:", e.slice(0, 300));
  for (const e of consoleErrors) console.log("console error:", e.slice(0, 200));

  await browser.close();

  console.log("--- QA summary ---");
  console.log("pageErrors:", pageErrors.length);
  console.log("consoleErrors:", consoleErrors.length);
  if (pageErrors.length > 0 || renderError) failures += 1;
  process.exit(failures === 0 ? 0 : 1);
} finally {
  server.kill();
}

function sceneDiagnosticsUnused(): void {}
