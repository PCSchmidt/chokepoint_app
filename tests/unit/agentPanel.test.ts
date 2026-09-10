/**
 * Agent panel UI tests (§4.4, §9.2): the answer view renders accepted text
 * with caveats, rejected-claim transparency, and never fabricated numbers.
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from "vitest";
import { renderAgentPanel, renderAgentAnswer } from "../../src/ui/agentPanel";

describe("agent panel render (§4.4)", () => {
  it("renders an input and ask control", () => {
    const el = document.createElement("div");
    let asked: string | null = null;
    renderAgentPanel(el, (q) => {
      asked = q;
    });
    const input = el.querySelector<HTMLInputElement>("[data-testid=agent-input]")!;
    input.value = "How many vessels are here?";
    (el.querySelector<HTMLElement>("[data-testid=agent-ask]") as HTMLElement).click();
    expect(asked).toBe("How many vessels are here?");
  });

  it("empty questions are not dispatched", () => {
    const el = document.createElement("div");
    let asked = 0;
    renderAgentPanel(el, () => {
      asked += 1;
    });
    const input = el.querySelector<HTMLInputElement>("[data-testid=agent-input]")!;
    input.value = "   ";
    (el.querySelector<HTMLElement>("[data-testid=agent-ask]") as HTMLElement).click();
    expect(asked).toBe(0);
  });

  it("answers render with a verdict badge, caveats, and rejected-claim transparency", () => {
    const el = document.createElement("div");
    renderAgentPanel(el, () => {});
    renderAgentAnswer(el, {
      text: "11 classified freight vessels were observed in the defined geofence during the window.",
      caveats: ["The baseline is the prior comparable window, not an official statistic."],
      rejected: [{ claim: "The port is experiencing a major disruption.", reason: "Causal language without independent evidence is rejected (§8.4 CAUSE)." }],
      evidenceRefs: ["metric:vessel_count"],
      verdict: "accepted_with_caveats",
    });
    expect(el.querySelector<HTMLElement>("[data-testid=agent-verdict]")!.textContent).toBe("EVALUATED");
    expect(el.querySelector<HTMLElement>("[data-testid=agent-text]")!.textContent).toContain("observed in the defined geofence");
    expect(el.textContent).toMatch(/Caveat:/);
    expect(el.textContent).toMatch(/Rejected:/);
  });

  it("a rejected verdict renders NOT ANSWERED with the abstention text", () => {
    const el = document.createElement("div");
    renderAgentPanel(el, () => {});
    renderAgentAnswer(el, {
      text: "no supported intent matched — try: vessel count, summary, baseline comparison, recent changes, or explain a metric",
      caveats: ["Insufficient evidence to answer."],
      rejected: [],
      evidenceRefs: [],
      verdict: "rejected",
    });
    expect(el.querySelector<HTMLElement>("[data-testid=agent-verdict]")!.textContent).toBe("NOT ANSWERED");
    expect(el.querySelector<HTMLElement>("[data-testid=agent-text]")!.textContent).toMatch(/no supported intent/);
  });
});
