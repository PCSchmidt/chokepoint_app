/**
 * Voice session (CHOKEPOINT-PLAN.md §4.4 optional voice, §8.6 voice safety,
 * §11.2 transcript rules, §9.2 src/agent/voiceSession.ts).
 *
 * Keyless local voice: browser Web Speech API (SpeechRecognition +
 * speechSynthesis) -> the SAME evaluator-gated text pipeline. No cloud, no
 * key; OpenAI Realtime remains a hosted-phase option behind the same
 * contract (Decision 2: voice only after evidence gates).
 *
 * §8.6 transactional rules enforced here:
 *  - the session reports what the pipeline returned (accept/refuse/abstain);
 *  - UI actions are applied by the caller through app state, and the spoken
 *    answer says "applied" only after the caller confirms;
 *  - the transcript is NEVER persisted (§11.2): it lives in memory for the
 *    duration of a turn and is dropped.
 *
 * The wall clock is not read here; turn timing belongs to the caller.
 */

export const VOICE_SESSION_VERSION = "voice-session-v1";

/** Injected browser speech surfaces (testable: fake in unit tests). */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechSynthesisLike {
  speak(utterance: { text: string; lang?: string; onend?: () => void }): void;
  cancel(): void;
}

export type VoiceAvailability =
  | { available: true }
  | { available: false; reason: string };

export interface VoiceTurnResult {
  /** The question as recognized (in-memory only; never persisted). */
  question: string;
  /** The final answer text (post-evaluator). */
  answer: string;
  outcome: "answered" | "rejected" | "ui_action_applied" | "ui_action_refused" | "error";
}

export interface VoiceTurn {
  question: string;
}

/**
 * Create a voice session bound to injected speech surfaces. Detection of
 * availability is the caller's first check: unsupported browsers get an
 * honest UNAVAILABLE state, never a silent no-op.
 */
export function detectVoiceAvailability(
  recognition: SpeechRecognitionLike | null | undefined,
  synthesis: SpeechSynthesisLike | null | undefined,
): VoiceAvailability {
  if (!recognition && !synthesis) {
    return { available: false, reason: "This browser exposes neither speech recognition nor speech synthesis." };
  }
  if (!recognition) {
    return { available: false, reason: "Speech recognition is not available in this browser; spoken questions cannot be heard." };
  }
  return { available: true };
}

/**
 * Run one voice turn: question in (already transcribed by the injected
 * recognition), pipeline call, answer text out. The caller owns applying
 * UI actions and speaking the answer.
 */
export interface VoiceTurnDeps {
  ask: (question: string) => Promise<{ answer: string; verdict: string | null; uiAction: { action: string } | null; uiActionApplied: boolean }>;
}

export async function runVoiceTurn(question: string, deps: VoiceTurnDeps): Promise<VoiceTurnResult> {
  const trimmed = question.trim();
  if (trimmed.length === 0) {
    return { question, answer: "I did not catch a question.", outcome: "error" };
  }
  try {
    const result = await deps.ask(trimmed);
    let answer = result.answer;
    if (result.uiAction) {
      // §8.6: only claim the visual state changed when the caller applied it.
      answer = result.uiActionApplied
        ? `${answer} Applied to the current view.`
        : `${answer} Not applied — no investigation is open.`;
    }
    return {
      question: trimmed,
      answer,
      outcome:
        result.uiAction && result.uiActionApplied
          ? "ui_action_applied"
          : result.uiAction
            ? "ui_action_refused"
            : result.verdict === "rejected"
              ? "rejected"
              : "answered",
    };
  } catch (err) {
    return {
      question: trimmed,
      answer: "The request failed; no answer was generated.",
      outcome: "error",
    };
  }
}

/**
 * Strip answer decorations not meant to be spoken: evidence refs and the
 * verdict badge text live in the visual panel, not in speech. Caveats stay —
 * speaking caveats is a §14.4 requirement.
 */
export function speakableAnswer(answer: string): string {
  return answer.replace(/Evidence: .*/g, "").replace(/\s+\./g, ".").trim();
}
