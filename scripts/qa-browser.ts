/**
 * Phase 3 browser QA (§12.5): boot the app, select a chokepoint, assert the
 * investigation renders WITHOUT Cesium errors, capture console/page errors,
 * and screenshot the investigation view. Fixture mode; no network needed
 * beyond localhost (Cesium offline imagery).
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
  await page.waitForSelector("[data-testid^=launcher-]", { timeout: 30_000 });
  console.log("launcher rendered: OK");

  // Select Long Beach — the rendering-error report from manual testing.
  await page.click("[data-testid=launcher-long-beach-approach]");
  await page.waitForSelector("[data-testid=card-vessel-count]", { timeout: 30_000 });
  await page.waitForTimeout(4000); // allow the globe to initialize and render

  const modeBadge = await page.textContent("[data-testid=mode-badge]");
  const cards = await page.locator(".metric-card").count();
  const attribution = await page.textContent("[data-testid=attribution-text]");
  console.log(`investigation view: cards=${cards}, attribution="${(attribution ?? "").slice(0, 40)}..."`);

  const renderError = pageErrors.find((e) => /An error occurred while rendering/i.test(e)) ?? null;
  const cesiumErrors = pageErrors.filter((e) => /Cesium|RuntimeError|DeveloperError/i.test(e));

  if (renderError) {
    failures += 1;
    console.error("RENDER ERROR present:", renderError.slice(0, 300));
  }
  for (const e of cesiumErrors) {
    console.log("Cesium error:", e.slice(0, 400));
  }
  for (const e of consoleErrors) {
    console.log("console error:", e.slice(0, 200));
  }
  if (cards < 6) {
    failures += 1;
    console.error("FAIL: expected 6 metric cards, got", cards);
  }
  if (!attribution || attribution.length < 10) {
    failures += 1;
    console.error("FAIL: attribution missing/empty");
  }

  await page.screenshot({ path: "research/qa/phase3-investigation.png", fullPage: false });
  console.log("screenshot saved: research/qa/phase3-investigation.png");

  // SIM badge visible (§3.1)
  const simVisible = await page.isVisible("[data-testid=mode-badge]");
  if (!simVisible) {
    failures += 1;
    console.error("FAIL: SIM badge not visible in fixture mode (§3.1)");
  }

  await browser.close();

  console.log("--- QA summary ---");
  console.log("pageErrors:", pageErrors.length, pageErrors.slice(0, 3));
  console.log("consoleErrors:", consoleErrors.length, consoleErrors.slice(0, 3));
  if (pageErrors.length > 0 || renderError) failures += 1;
  process.exit(failures === 0 ? 0 : 1);
} finally {
  server.kill();
}
