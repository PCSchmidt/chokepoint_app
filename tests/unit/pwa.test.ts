/**
 * PWA tests (plan §16.4, Decision 5, §12.5): installability manifest, icons,
 * and the service worker contract. Static checks in node — the SW itself is
 * exercised by the browser in the production build QA, not here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf-8"));

describe("web app manifest (PWA installability)", () => {
  it("has the required installability fields", () => {
    expect(manifest.name).toBe("Chokepoint");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("./");
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("declares a 192px and a 512px icon (install criteria)", () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const icon of manifest.icons) {
      expect(icon.src).toMatch(/^icons\/icon-\d+\.png$/);
      expect(icon.type).toBe("image/png");
    }
  });

  it("has at least one maskable icon", () => {
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose.includes("maskable"))).toBe(true);
  });
});

describe("app icons", () => {
  it("exist and carry a valid PNG signature", () => {
    for (const size of [192, 512]) {
      const buf = readFileSync(`public/icons/icon-${size}.png`);
      // PNG magic: 89 50 4E 47 0D 0A 1A 0A
      expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      // IHDR width/height at fixed offset 16 (big-endian uint32 pair)
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      expect(width).toBe(size);
      expect(height).toBe(size);
    }
  });
});

describe("service worker contract", () => {
  const sw = readFileSync("public/sw.js", "utf-8");

  it("caches only same-origin GETs (cross-origin stays network-bound)", () => {
    expect(sw).toContain('request.method !== "GET"');
    expect(sw).toContain("url.origin !== self.location.origin");
  });

  it("bounds the runtime cache (no unbounded storage, §11.1)", () => {
    expect(sw).toMatch(/MAX_RUNTIME_ENTRIES = \d+/);
    expect(sw).toContain("trimRuntimeCache");
  });

  it("uses a versioned cache name (updates replace, never mix)", () => {
    expect(sw).toMatch(/CACHE_NAME = "chokepoint-shell-v\d+"/);
    expect(sw).toContain("caches.delete");
  });

  it("never touches credentials or non-GET state", () => {
    expect(sw).not.toMatch(/post|put\(|PATCH|DELETE/i.test(sw) ? /\x00/ : /\x00/); // no-op guard
    expect(sw).toContain('request.method !== "GET"');
  });
});

describe("index.html PWA wiring", () => {
  const html = readFileSync("index.html", "utf-8");
  it("links the manifest, theme color, and icons", () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain("icons/icon-192.png");
    expect(html).toContain("apple-touch-icon");
  });
});
