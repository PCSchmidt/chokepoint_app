/**
 * Groundedness evaluation report (§12.4, §12.6): runs the labeled scenarios
 * from tests/evaluation/agent.evaluation.test.ts logic against the live
 * pipeline and writes evaluation-reports/agent-<date>.json/md. Fixture mode.
 *
 * Command: npm run eval:agent
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { createDataManager } from "../src/data/manager";
import { askAgent } from "../src/agent/pipeline";
import { evaluateClaims } from "../src/agent/evaluator";
import type { AgentClaim } from "../src/agent/tools";

interface ScenarioResult {
  scenario: string;
  question: string;
  expected: string;
  actual: string;
  pass: boolean;
}

const WINDOW = { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T15:20:00Z" };
const manager = await createDataManager({ mode: "fixture" });
const results: ScenarioResult[] = [];

function record(scenario: string, question: string, expected: RegExp | boolean | string, actual: string | boolean): void {
  const pass =
    typeof expected === "boolean"
      ? expected === actual
      : typeof expected === "string"
        ? expected === actual
        : expected.test(actual);
  results.push({ scenario, question, expected: String(expected), actual: String(actual), pass });
}

// --- Supported intents answer from deterministic metrics -------------------
{
  const { answer } = await askAgent("How many vessels are at Long Beach?", manager, { chokepointId: "long-beach-approach", window: WINDOW });
  record("count_vessels answers with observed count semantics", "How many vessels are at Long Beach?", /observed in the defined geofence/, answer.text);
  record("count_vessels verdict evaluated", "How many vessels are at Long Beach?", true, answer.verdict !== "rejected");
}
{
  const { answer } = await askAgent("Summarize Singapore", manager, { chokepointId: "singapore-malacca-approach", window: WINDOW });
  record("summarize answers for Singapore", "Summarize Singapore", /observed in the defined geofence/, answer.text);
}
{
  const { answer } = await askAgent("explain how moving fraction is calculated", manager, { chokepointId: "long-beach-approach", window: WINDOW });
  record("explain_metric documents the formula", "explain how moving fraction is calculated", /derived|Fraction of/, answer.text);
}

// --- Abstention quality (§12.4) --------------------------------------------
{
  const { answer } = await askAgent("What is the stock price of Apple?", manager, { chokepointId: "long-beach-approach", window: WINDOW });
  record("out-of-domain question abstains", "What is the stock price of Apple?", /no supported intent/, answer.text);
  record("out-of-domain verdict rejected", "What is the stock price of Apple?", "rejected", answer.verdict);
}
{
  const { answer } = await askAgent("are any vessels suspicious", manager, { chokepointId: "long-beach-approach", window: WINDOW });
  record("threat question abstains (never answers)", "are any vessels suspicious", /no supported intent/, answer.text);
}
{
  const { answer } = await askAgent("How many vessels are at Suez?", manager, { chokepointId: "suez-canal-approaches", window: WINDOW });
  record("Suez no-data is unknown-not-zero", "How many vessels are at Suez?", /Insufficient evidence|unknown, not zero/, answer.text);
  record("Suez answer contains no zero count", "How many vessels are at Suez?", false, /\b0 (classified|freight|vessels)/.test(answer.text));
}

// --- Evaluator rejection table (§8.4) --------------------------------------
const metricValues = new Map<string, number | null>([["vessel_count", 11]]);
const rejectionCases: Array<{ text: string; reason: RegExp }> = [
  { text: "The port is experiencing a major disruption.", reason: /Causal language|disruption/i },
  { text: "A suspicious vessel loitered near the anchorage.", reason: /THREAT/ },
  { text: "Vessel traffic will increase next week.", reason: /PREDICTION/ },
  { text: "This vessel intends to avoid inspection.", reason: /INTENT/ },
];
for (const [i, c] of rejectionCases.entries()) {
  const claim: AgentClaim = { id: `r${i}`, text: c.text, category: "OBSERVATION", support: [{ kind: "metric", id: "vessel_count" }], confidence: 0.9 };
  const v = evaluateClaims([claim], { metricValues, sourceHealth: "fresh" });
  record(`rejected language: ${c.text.slice(0, 30)}...`, c.text, c.reason, v.rejectedClaims[0]?.reason ?? "NOT REJECTED");
  record(`rejection verdict for: ${c.text.slice(0, 30)}...`, c.text, "rejected", v.verdict);
}
{
  const claim: AgentClaim = { id: "scope", text: "All vessels at the port were counted: 11 classified freight vessels were observed.", category: "CALCULATION", support: [{ kind: "metric", id: "vessel_count" }], confidence: 0.9 };
  const v = evaluateClaims([claim], { metricValues, sourceHealth: "fresh" });
  record("scope overreach rejected", claim.text, /Scope overreach/, v.rejectedClaims[0]?.reason ?? "NOT REJECTED");
}
{
  const claim: AgentClaim = { id: "fab", text: "47 classified freight vessels were observed.", category: "CALCULATION", support: [{ kind: "metric", id: "vessel_count" }], confidence: 0.9 };
  const v = evaluateClaims([claim], { metricValues, sourceHealth: "fresh" });
  record("fabricated number rejected", claim.text, /does not match any metric/, v.rejectedClaims[0]?.reason ?? "NOT REJECTED");
}


// --- Multimodal (ADR-0012/0013/0015) ---------------------------------------
{
  const LAND_WINDOW = { startAt: "2026-09-10T07:00:00Z", endAt: "2026-09-10T12:00:00Z" };
  const land = await askAgent("what's the wait at the El Paso crossing", manager, { chokepointId: "el-paso-border-crossings", window: LAND_WINDOW });
  record("border wait answered from OBSERVED facility metrics", "what's the wait at El Paso", /observed; reported by CBP/, land.answer.text);
  record("facility answer carries the real sample value", "what's the wait at El Paso", /3 minutes/, land.answer.text);
  const air = await askAgent("how many cargo flights at LAX", manager, { chokepointId: "lax-cargo-air", window: LAND_WINDOW });
  record("air profile states the geometry gate honestly", "how many cargo flights at LAX", /placeholder/, air.answer.text);
  record("air profile never fabricates a count", "how many cargo flights at LAX", false, /\b\d+ (cargo )?(flights|aircraft)\b/.test(air.answer.text));
  const longQuestion = await askAgent("how long is the wait at El Paso", manager, { chokepointId: "el-paso-border-crossings", window: LAND_WINDOW });
  record("wait question does not misroute to Long Beach", "how long is the wait at El Paso", /El Paso - (?:Bridge of the Americas|Ysleta)/, longQuestion.answer.text);
  const fabricatedWait: AgentClaim = {
    id: "claim-facility-fab",
    text: "The commercial-vehicle wait at El Paso - BOTA was 999 minutes (observed; reported by CBP).",
    category: "OBSERVATION",
    support: [{ kind: "metric", id: "sim-facility:cbp:240201:bridge:2026-09-10T07:36:42Z" }],
    confidence: 0.9,
  };
  const fw = evaluateClaims([fabricatedWait], {
    metricValues: new Map([["sim-facility:cbp:240201:bridge:2026-09-10T07:36:42Z", 3]]),
    sourceHealth: "fresh",
  });
  record("fabricated facility wait rejected", fabricatedWait.text, /does not match any metric/, fw.rejectedClaims[0]?.reason ?? "NOT REJECTED");
}

const passCount = results.filter((r) => r.pass).length;
const report = {
  generatedAt: new Date().toISOString(),
  suite: "agent-groundedness-v1",
  evaluatorVersion: "claim-evaluator-v1",
  total: results.length,
  passed: passCount,
  failed: results.length - passCount,
  results,
};
mkdirSync("evaluation-reports", { recursive: true });
const day = report.generatedAt.slice(0, 10);
writeFileSync(`evaluation-reports/agent-${day}.json`, JSON.stringify(report, null, 2));
const md = [
  "# Agent groundedness evaluation (§12.4, v1)",
  "",
  `- Generated: ${report.generatedAt}`,
  `- Evaluator: ${report.evaluatorVersion}`,
  `- Results: ${report.passed}/${report.total} scenarios pass`,
  "",
  "| Scenario | Expected | Pass |",
  "|---|---|---|",
  ...results.map((r) => `| ${r.scenario} | ${r.expected.replace(/\|/g, "/").slice(0, 60)} | ${r.pass ? "yes" : "**NO**"} |`),
  "",
  report.failed === 0 ? "**Result: PASS**" : `**Result: FAIL (${report.failed} failures)**`,
  "",
].join("\n");
writeFileSync(`evaluation-reports/agent-${day}.md`, md);
console.log(md);
