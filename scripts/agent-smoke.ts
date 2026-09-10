// Manual smoke of the agent pipeline incl. multimodal (dev tool; not a test).
import { createDataManager } from "../src/data/manager";
import { askAgent } from "../src/agent/pipeline";
import { parseQuestion } from "../src/agent/intent";

const m = await createDataManager({ mode: "fixture" });
const w = { startAt: "2026-09-10T07:00:00Z", endAt: "2026-09-10T12:00:00Z" };
const questions = [
  "what's the wait at the El Paso crossing",
  "how long is the wait at El Paso",
  "how many vessels are at Long Beach?",
  "show me cargo flights",
  "what's the wait at the LAX crossing",
];
for (const q of questions) {
  const parsed = parseQuestion(q, m.listChokepoints());
  const { answer, verdict } = await askAgent(q, m, { chokepointId: parsed.intent?.chokepointId ?? null, window: w });
  console.log("Q:", q, "| tool:", parsed.intent?.tool, "| cp:", parsed.intent?.chokepointId, "| verdict:", verdict?.verdict ?? "abstained");
  console.log("  A:", answer.text.slice(0, 170));
}
