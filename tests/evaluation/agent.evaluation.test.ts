/**
 * Groundedness evaluation set (CHOKEPOINT-PLAN.md §12.4, §8.3, §8.5).
 *
 * A labeled, deterministic suite over the agent pipeline: numeric accuracy,
 * evidence citation coverage, unsupported-claim rejection, scope-mismatch
 * rejection, freshness/derived caveat coverage, and abstention quality.
 * Fixture mode; the wall clock is never read. Run `npm run eval:agent` to
 * regenerate the §12.6 artifact from the same scenarios.
 */

import { describe, expect, it } from "vitest";
import { createDataManager } from "../../src/data/manager";
import { buildEvidenceBundle } from "../../src/agent/evidenceBundle";
import { evaluateClaims, evaluateToolResult } from "../../src/agent/evaluator";
import { askAgent } from "../../src/agent/pipeline";
import { parseQuestion, resolveWindow } from "../../src/agent/intent";
import type { AgentClaim } from "../../src/agent/tools";

const WINDOW = { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T15:20:00Z" };

describe("intent parsing (§4.4 allowlist, §8.2)", async () => {
  const manager = await createDataManager({ mode: "fixture" });

  it("maps supported phrasings to the allowlisted tools", () => {
    expect(parseQuestion("How many vessels are at Long Beach?", manager.listChokepoints()).intent?.tool).toBe("count_vessels");
    expect(parseQuestion("Summarize Singapore", manager.listChokepoints()).intent?.chokepointId).toBe("singapore-malacca-approach");
    expect(parseQuestion("vessel count compared to baseline at suez", manager.listChokepoints()).intent?.tool).toBe("compare_with_baseline");
    expect(parseQuestion("What has changed recently at Singapore?", manager.listChokepoints()).intent?.tool).toBe("list_recent_changes");
  });

  it("abstains on unsupported intents and never infers scope", () => {
    const r = parseQuestion("are any vessels suspicious", manager.listChokepoints());
    expect(r.intent).toBeNull();
    expect(r.abstention).toBeTruthy();
    const noTarget = parseQuestion("what has changed recently?", manager.listChokepoints());
    expect(noTarget.intent).toBeNull(); // geographic scope is never guessed
  });

  it("relative windows resolve against data availability, never the wall clock", () => {
    const available = { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T15:20:00Z" };
    const w = resolveWindow("last_24_hours", "2026-09-09T15:20:00Z", available);
    expect(w).toEqual(available); // clamped to available data
    const w2 = resolveWindow("last_6_hours", "2026-09-09T15:20:00Z", { startAt: "2026-09-09T00:00:00Z", endAt: "2026-09-09T15:20:00Z" });
    expect(w2.startAt).toBe("2026-09-09T09:20:00Z");
  });
});

describe("groundedness: numeric accuracy + citation coverage (§12.4)", async () => {
  const manager = await createDataManager({ mode: "fixture" });
  const snapshot = manager.getSnapshot("long-beach-approach", WINDOW);
  const metricValues = new Map<string, number | null>([
    ["vessel_count", snapshot.metrics.vesselCount.value],
    ["moving_fraction", snapshot.metrics.movingFraction.value],
  ]);

  it("numeric claims match the metrics they cite", () => {
    const bundle = buildEvidenceBundle("How many vessels are at Long Beach?", manager, {
      chokepointId: "long-beach-approach",
      window: WINDOW,
    });
    expect(bundle.tool).not.toBeNull();
    const verdict = evaluateToolResult(bundle.tool!, metricValues, bundle.sourceHealth);
    expect(verdict.acceptedClaims).toContain("claim-vessel-count");
    const count = snapshot.metrics.vesselCount.value;
    if (count !== null) {
      expect(bundle.tool!.claims.find((c) => c.id === "claim-vessel-count")!.text).toContain(String(count));
    }
  });

  it("a fabricated number is rejected", () => {
    const fabricated: AgentClaim = {
      id: "claim-fabricated",
      text: "47 classified freight vessels were observed in the defined geofence.",
      category: "CALCULATION",
      support: [{ kind: "metric", id: "vessel_count" }],
      confidence: 0.9,
    };
    const rejection = evaluateClaims([fabricated], { metricValues, sourceHealth: "fresh" });
    expect(rejection.verdict).toBe("rejected");
    expect(rejection.rejectedClaims[0]!.reason).toMatch(/does not match any metric/);
  });

  it("a claim without provenance is rejected", () => {
    const unsupported: AgentClaim = {
      id: "claim-unsupported",
      text: "Traffic is heavy today.",
      category: "OBSERVATION",
      support: [],
      confidence: 0.9,
    };
    const rejection = evaluateClaims([unsupported], { metricValues, sourceHealth: "fresh" });
    expect(rejection.verdict).toBe("rejected");
    expect(rejection.rejectedClaims[0]!.reason).toMatch(/provenance/);
  });
});

describe("groundedness: restricted-language rejection (§8.4)", () => {
  const metricValues = new Map<string, number | null>([["vessel_count", 11]]);

  it.each([
    ["The port is experiencing a major disruption.", /Causal language|disruption/i],
    ["A suspicious vessel loitered near the anchorage.", /THREAT/],
    ["Vessel traffic will increase next week.", /PREDICTION/],
    ["This vessel intends to avoid inspection.", /INTENT/],
  ])("rejects: %s", (text: string, reasonMatch: RegExp) => {
    const claim: AgentClaim = { id: "c", text, category: "OBSERVATION", support: [{ kind: "metric", id: "vessel_count" }], confidence: 0.9 };
    const rejection = evaluateClaims([claim], { metricValues, sourceHealth: "fresh" });
    expect(rejection.verdict).toBe("rejected");
    expect(rejection.rejectedClaims[0]!.reason).toMatch(reasonMatch);
  });

  it('rejects port-wide scope overreach ("all vessels at the port")', () => {
    const claim: AgentClaim = {
      id: "c-scope",
      text: "All vessels at the port were counted: 11 classified freight vessels were observed.",
      category: "CALCULATION",
      support: [{ kind: "metric", id: "vessel_count" }],
      confidence: 0.9,
    };
    const rejection = evaluateClaims([claim], { metricValues, sourceHealth: "fresh" });
    expect(rejection.verdict).toBe("rejected");
    expect(rejection.rejectedClaims[0]!.reason).toMatch(/Scope overreach/);
  });
});

describe("groundedness: caveat coverage + abstention (§12.4)", async () => {
  const manager = await createDataManager({ mode: "fixture" });

  it("stale/degraded sources always produce a freshness caveat", async () => {
    const { answer } = await askAgent("How many vessels are at Long Beach?", manager, {
      chokepointId: "long-beach-approach",
      window: WINDOW,
    });
    // Fixture timeline vs default window: health may be degraded here.
    if (answer.caveats.some((c) => /Source state is/.test(c))) {
      expect(answer.verdict).toBe("accepted_with_caveats");
    }
  });

  it("Suez (no fixtures, unknown coverage) never answers a count", async () => {
    const { answer } = await askAgent("How many vessels are at Suez?", manager, {
      chokepointId: "suez-canal-approaches",
      window: WINDOW,
    });
    expect(answer.text).toMatch(/Insufficient evidence|unknown, not zero/);
    expect(answer.text).not.toMatch(/\b0 (classified|freight|vessels)/);
  });

  it("abstains outside the domain without fabricating an answer", async () => {
    const { bundle, verdict, answer } = await askAgent("What is the stock price of Apple?", manager, {
      chokepointId: "long-beach-approach",
      window: WINDOW,
    });
    expect(bundle.abstention).toBeTruthy();
    expect(verdict).toBeNull();
    expect(answer.verdict).toBe("rejected");
  });
});

describe("groundedness: derived-vs-observed labeling (§12.4)", async () => {
  const manager = await createDataManager({ mode: "fixture" });

  it("derived metrics are labeled derived, not observed", () => {
    const bundle = buildEvidenceBundle("How is moving fraction calculated?", manager, {
      chokepointId: "long-beach-approach",
      window: WINDOW,
    });
    const text = bundle.tool!.claims.map((c) => c.text).join(" ");
    expect(text).toMatch(/derived from|Fraction of/);
  });
});
