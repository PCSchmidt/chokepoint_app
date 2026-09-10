// Quick manual smoke of the full agent pipeline (dev tool; not a test).
import { createDataManager } from "../src/data/manager";
import { askAgent } from "../src/agent/pipeline";

const m = await createDataManager({ mode: "fixture" });
const w = m.defaultWindow();
const questions = [
  "How many vessels are at Long Beach?",
  "Summarize Singapore over the last 24 hours",
  "vessel count compared to baseline at suez",
  "What has changed recently at Long Beach?",
  "explain how moving fraction is calculated",
  "are any vessels suspicious",
  "What is the stock price of Apple?",
];
for (const q of questions) {
  const { answer, verdict } = await askAgent(q, m, { chokepointId: "long-beach-approach", window: w });
  console.log("Q:", q);
  console.log("  verdict:", verdict?.verdict ?? "abstained");
  console.log("  A:", answer.text.slice(0, 160));
  if (answer.caveats.length) console.log("  caveats:", answer.caveats.join(" | ").slice(0, 140));
  for (const r of answer.rejected) console.log("  REJECTED:", r.claim.slice(0, 60), "->", r.reason.slice(0, 60));
}
