/**
 * Agent text query surface (CHOKEPOINT-PLAN.md §4.4, §9.2 src/ui).
 *
 * A question box in the investigation view. The pipeline is the ONLY path:
 * answer text comes from accepted claims, caveats render visibly, rejected
 * claims render as transparency (never as answer text, §8.5), and the
 * evidence refs link the user into the evidence drawer (§4.5).
 */

export interface AgentAnswerView {
  text: string;
  caveats: string[];
  rejected: Array<{ claim: string; reason: string }>;
  evidenceRefs: string[];
  verdict: "accepted" | "accepted_with_caveats" | "rejected";
}

export function renderAgentPanel(
  container: HTMLElement,
  onAsk: (question: string) => void,
): void {
  container.innerHTML = "";
  const details = document.createElement("details");
  details.className = "agent-panel";
  details.dataset.testid = "agent-panel";
  const summary = document.createElement("summary");
  summary.textContent = "Ask about this chokepoint";
  details.appendChild(summary);
  const row = document.createElement("div");
  row.className = "agent-row";
  const input = document.createElement("input");
  input.type = "text";
  input.dataset.testid = "agent-input";
  input.placeholder = "e.g. How many vessels are here?";
  input.setAttribute("aria-label", "Ask a question about the current chokepoint");
  const ask = document.createElement("button");
  ask.dataset.testid = "agent-ask";
  ask.textContent = "Ask";
  const submit = (): void => {
    const q = input.value.trim();
    if (q.length === 0) return;
    onAsk(q);
  };
  ask.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  row.append(input, ask);
  const answerEl = document.createElement("div");
  answerEl.className = "agent-answer";
  answerEl.dataset.testid = "agent-answer";
  details.append(row, answerEl);
  container.appendChild(details);
}

/** Render an answer (or abstention) with caveats and rejected-claim transparency. */
export function renderAgentAnswer(container: HTMLElement, answer: AgentAnswerView | null): void {
  const el = container.querySelector<HTMLElement>("[data-testid=agent-answer]");
  if (!el) return;
  el.innerHTML = "";
  if (!answer) return;
  const verdictBadge = document.createElement("span");
  verdictBadge.className = `badge agent-verdict agent-${answer.verdict}`;
  verdictBadge.dataset.testid = "agent-verdict";
  verdictBadge.textContent = answer.verdict === "rejected" ? "NOT ANSWERED" : "EVALUATED";
  const text = document.createElement("p");
  text.className = "agent-text";
  text.dataset.testid = "agent-text";
  text.textContent = answer.text;
  el.append(verdictBadge, text);
  for (const caveat of answer.caveats) {
    const c = document.createElement("p");
    c.className = "agent-caveat";
    c.textContent = `Caveat: ${caveat}`;
    el.appendChild(c);
  }
  for (const r of answer.rejected) {
    const r1 = document.createElement("p");
    r1.className = "agent-rejected";
    r1.textContent = `Rejected: "${r.claim.slice(0, 80)}" — ${r.reason}`;
    el.appendChild(r1);
  }
  if (answer.evidenceRefs.length > 0) {
    const refs = document.createElement("p");
    refs.className = "agent-refs";
    refs.textContent = `Evidence: ${answer.evidenceRefs.slice(0, 4).join(", ")}${answer.evidenceRefs.length > 4 ? "…" : ""}`;
    el.appendChild(refs);
  }
}
