/**
 * Voice session tests (§4.4, §8.6, §11.2): transactional outcomes, honest
 * unavailability, transcript non-persistence, and spoken-answer shaping.
 * All speech surfaces are fakes — no browser, no network.
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from "vitest";
import { detectVoiceAvailability, runVoiceTurn, speakableAnswer, type SpeechRecognitionLike } from "../../src/agent/voiceSession";
import { renderVoicePanel, setVoiceListening } from "../../src/ui/voicePanel";

describe("voice availability (honest states)", () => {
  it("reports unavailable with a reason when recognition is missing", () => {
    const a = detectVoiceAvailability(null, { speak: () => {}, cancel: () => {} });
    expect(a.available).toBe(false);
    if (!a.available) expect(a.reason).toMatch(/recognition/i);
  });

  it("reports available when recognition exists", () => {
    const fake: SpeechRecognitionLike = {
      lang: "en-US", continuous: false, interimResults: false,
      start() {}, stop() {}, onresult: null, onerror: null, onend: null,
    };
    expect(detectVoiceAvailability(fake, null).available).toBe(true);
  });
});

describe("voice turn (§8.6 transactional)", () => {
  it("reports ui_action_applied only when the caller applied the action", async () => {
    const applied = await runVoiceTurn("start replay", {
      ask: async () => ({ answer: "Action accepted: replay started.", verdict: "accepted", uiAction: { action: "start_replay" }, uiActionApplied: true }),
    });
    expect(applied.outcome).toBe("ui_action_applied");
    expect(applied.answer).toMatch(/Applied to the current view/);

    const refused = await runVoiceTurn("start replay", {
      ask: async () => ({ answer: "Action accepted: replay started.", verdict: "accepted", uiAction: { action: "start_replay" }, uiActionApplied: false }),
    });
    expect(refused.outcome).toBe("ui_action_refused");
    expect(refused.answer).toMatch(/Not applied/);
    // §8.6: an unapplied action is never spoken as applied.
    expect(refused.answer).not.toMatch(/^Applied/);
  });

  it("reports pipeline failures honestly (never fabricates)", async () => {
    const r = await runVoiceTurn("how many vessels", {
      ask: async () => {
        throw new Error("boom");
      },
    });
    expect(r.outcome).toBe("error");
    expect(r.answer).toMatch(/failed; no answer was generated/);
  });

  it("rejected verdicts speak the refusal, not an invented answer", async () => {
    const r = await runVoiceTurn("what is the stock price of Apple", {
      ask: async () => ({
        answer: "no supported intent matched — try: vessel count, summary, baseline comparison, recent changes, or explain a metric",
        verdict: "rejected",
        uiAction: null,
        uiActionApplied: false,
      }),
    });
    expect(r.outcome).toBe("rejected");
    expect(r.answer).toMatch(/no supported intent/);
  });
});

describe("spoken-answer shaping (§14.4)", () => {
  it("strips evidence refs, keeps caveats", () => {
    const spoken = speakableAnswer(
      "11 classified freight vessels were observed in the defined geofence. Caveat: the baseline is the prior comparable window. Evidence: metric:vessel_count",
    );
    expect(spoken).not.toMatch(/Evidence:/);
    expect(spoken).toMatch(/Caveat:/);
    expect(spoken).toMatch(/observed in the defined geofence/);
  });
});

describe("voice panel render (§9.2)", () => {
  it("renders UNAVAILABLE honestly when speech is unsupported", () => {
    const el = document.createElement("div");
    renderVoicePanel(el, { available: false, reason: "Speech recognition is not available in this browser" }, { onStartListening: () => {}, onStopListening: () => {} });
    expect(el.querySelector<HTMLElement>("[data-testid=voice-unavailable]")!.textContent).toMatch(/UNAVAILABLE/);
  });

  it("toggles listening state and fires the matching hook", () => {
    const el = document.createElement("div");
    let started = 0;
    let stopped = 0;
    renderVoicePanel(el, { available: true }, { onStartListening: () => (started += 1), onStopListening: () => (stopped += 1) });
    const mic = el.querySelector<HTMLElement>("[data-testid=voice-mic]") as HTMLElement;
    mic.click();
    expect(started).toBe(1);
    expect(mic.dataset.state).toBe("listening");
    (mic as HTMLElement).click();
    expect(stopped).toBe(1);
    // external state sync (e.g. recognition onend)
    setVoiceListening(el, false);
    expect(mic.dataset.state).toBe("idle");
  });
});
