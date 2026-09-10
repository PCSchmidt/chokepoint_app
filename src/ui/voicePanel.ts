/**
 * Voice panel (CHOKEPOINT-PLAN.md §4.4, §8.6, §9.2 src/ui).
 *
 * Mic control + honest availability state. The transcript renders in the
 * SAME answer surface as the text agent (one source of truth); nothing is
 * persisted (§11.2). Unsupported browsers see UNAVAILABLE, never a silent
 * control.
 */

export interface VoicePanelHooks {
  onVoiceQuestion: (question: string) => void;
  onSpeak: (text: string) => void;
}

export function renderVoicePanel(
  container: HTMLElement,
  availability: { available: boolean; reason?: string },
  hooks: { onStartListening: () => void; onStopListening: () => void },
): void {
  container.innerHTML = "";
  const details = document.createElement("details");
  details.className = "voice-panel";
  details.dataset.testid = "voice-panel";
  const summary = document.createElement("summary");
  summary.textContent = "Voice (experimental)";
  details.appendChild(summary);

  if (!availability.available) {
    const note = document.createElement("p");
    note.className = "voice-unavailable";
    note.dataset.testid = "voice-unavailable";
    note.textContent = `Voice UNAVAILABLE: ${availability.reason ?? "not supported"}`;
    details.appendChild(note);
    container.appendChild(details);
    return;
  }

  const mic = document.createElement("button");
  mic.dataset.testid = "voice-mic";
  mic.className = "voice-mic";
  mic.textContent = "Start listening";
  mic.dataset.state = "idle";
  const status = document.createElement("span");
  status.className = "voice-status";
  status.dataset.testid = "voice-status";
  status.textContent = "Idle — click to speak";
  const setListening = (value: boolean): void => {
    mic.dataset.state = value ? "listening" : "idle";
    mic.textContent = value ? "Stop listening" : "Start listening";
    status.textContent = value ? "Listening…" : "Idle";
  };
  mic.addEventListener("click", () => {
    const nowListening = mic.dataset.state !== "listening";
    setListening(nowListening);
    if (nowListening) hooks.onStartListening();
    else hooks.onStopListening();
  });
  // expose for main wiring (state lives in the recognition controller)
  (mic as unknown as { __setListening: (v: boolean) => void }).__setListening = setListening;

  const note = document.createElement("p");
  note.className = "voice-note";
  note.textContent = "Answers are the evaluator-checked text answers. Transcripts are not stored.";
  details.append(mic, status, note);
  container.appendChild(details);
}

/** Reflect the listening state from outside (main.ts drives it). */
export function setVoiceListening(container: HTMLElement, value: boolean): void {
  const mic = container.querySelector<HTMLElement>("[data-testid=voice-mic]");
  if (!mic) return;
  const setter = (mic as unknown as { __setListening?: (v: boolean) => void }).__setListening;
  setter?.(value);
}
