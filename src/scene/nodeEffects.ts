/**
 * Node marker effects (NETWORK-VIEW-PLAN.md Phase 1.5 P2/P3/P4).
 *
 * Pure helpers for the network presence layer. The sprite DRAW needs a canvas
 * (browser-only, called from globe.ts); the layout math, pulse sizing, and
 * dash-pattern rotation are pure and node-testable. All motion is driven by
 * the Cesium viewer clock — which only advances on actual renders under
 * requestRenderMode — so animations freeze when idle and never read the wall
 * clock (§12.5).
 */

import type { NodeMarker } from "./globe";

export const NODE_SPRITE = {
  width: 148,
  height: 44,
  /** §9.3 badge -> border color (red is reserved for degraded; never generic). */
  badgeColor: {
    LIVE: "#34d399",
    DERIVED: "#38bdf8",
    ESTIMATE: "#38bdf8",
    SIM: "#94a3b8",
    STALE: "#fcd34d",
    UNKNOWN: "#9ca3af",
  } as Readonly<Record<string, string>>,
};

/**
 * Sprite layout (pure): rows the canvas draw renders. Exposed so node tests
 * can verify label content without a DOM canvas.
 */
export function nodeSpriteLayout(m: NodeMarker): {
  name: string;
  headline: string;
  border: string;
} {
  return {
    name: m.name,
    headline: m.headline,
    border: NODE_SPRITE.badgeColor[m.badge] ?? NODE_SPRITE.badgeColor.UNKNOWN!,
  };
}

/**
 * Draw the node sprite: a compact label plate (name + headline metric) with a
 * badge-colored border. Deterministic given the marker; no clock involvement.
 */
export function drawNodeSprite(m: NodeMarker): HTMLCanvasElement {
  const layout = nodeSpriteLayout(m);
  const canvas = document.createElement("canvas");
  canvas.width = NODE_SPRITE.width;
  canvas.height = NODE_SPRITE.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const radius = 8;
  const w = canvas.width - 2;
  const h = canvas.height - 2;
  // Rounded plate
  ctx.beginPath();
  ctx.moveTo(1 + radius, 1);
  ctx.arcTo(1 + w, 1, 1 + w, 1 + h, radius);
  ctx.arcTo(1 + w, 1 + h, 1, 1 + h, radius);
  ctx.arcTo(1, 1 + h, 1, 1, radius);
  ctx.arcTo(1, 1, 1 + w, 1, radius);
  ctx.closePath();
  ctx.fillStyle = "rgba(8, 22, 38, 0.85)";
  ctx.fill();
  ctx.strokeStyle = layout.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Name
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillText(layout.name, 10, 18, NODE_SPRITE.width - 20);
  // Headline
  ctx.fillStyle = layout.border;
  ctx.font = "500 12px ui-monospace, monospace";
  ctx.fillText(layout.headline, 10, 35, NODE_SPRITE.width - 20);
  return canvas;
}

/**
 * Pulse pixel size (P4): oscillates 14..30 px with a ~2s period, scaled a
 * little by cohort size (bounded — the ring is an affordance, not a scale
 * claim about cohort magnitude).
 */
export function pulsePixelSize(cohort: number, time: unknown): number {
  const seconds =
    typeof time === "object" && time !== null && "secondsOfDay" in (time as Record<string, unknown>)
      ? ((time as { julianDateNumber: number }).julianDateNumber * 86400 +
          (time as { secondsOfDay: number }).secondsOfDay)
      : 0;
  const phase = (seconds % 2) / 2; // 0..1 over ~2s
  const wave = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI); // smooth 0->1->0
  const boost = Math.min(8, cohort);
  return 14 + wave * (12 + boost);
}

/**
 * Flow dash pattern (P3): a 16-bit pattern rotated by the clock. When flow is
 * inactive the rotation freezes (constant offset), so paused replay = static
 * dashes. The returned value feeds PolylineDashMaterialProperty.dashPattern.
 */
/**
 * Pure pattern rotation (P3): the 16-bit dash runner shifted by `shift`
 * positions. Cesium wiring (CallbackProperty + clock) lives in globe.ts.
 */
export function rotatePattern(base: number, shift: number): number {
  const s = ((shift % 16) + 16) % 16;
  return ((base << s) | (base >>> (16 - s))) & 0xffff;
}
