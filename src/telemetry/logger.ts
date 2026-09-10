/**
 * Structured logs (CHOKEPOINT-PLAN.md §13.3, §9.2 src/telemetry).
 *
 * One-line JSON logs with the §13.3 fields: correlation id, request id,
 * source id, chokepoint id, metric/detector version, result status,
 * duration, error class, data quality state.
 *
 * REDACTION (§13.3): API keys, authorization headers, and voice transcripts
 * NEVER enter a log line. The logger has no field for them; free-form
 * messages are scrubbed for key-like patterns defensively.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  correlationId?: string | undefined;
  requestId?: string | undefined;
  sourceId?: string | undefined;
  chokepointId?: string | undefined;
  version?: string | undefined;
  resultStatus?: string | undefined;
  durationMs?: number | undefined;
  errorClass?: string | undefined;
  qualityState?: string | undefined;
  [key: string]: unknown;
}

export interface LogLine extends LogFields {
  time: string;
  level: LogLevel;
  msg: string;
}

/** Defensive redaction: key-like material never reaches a log line. */
const REDACT_PATTERNS: RegExp[] = [
  /([?&](?:key|apikey|api_key|token|authorization)=)[^&\s"]+/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[^\s"]+/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const pattern of REDACT_PATTERNS) {
    out = out.replace(pattern, "$1<redacted>");
  }
  return out;
}

export type LogSink = (line: string) => void;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** JSON-lines logger. One object per line; never multi-line (§13.3). */
export class StructuredLogger {
  private readonly sink: LogSink;
  private readonly minLevel: LogLevel;
  private correlationCounter = 0;

  constructor(sink: LogSink = (line) => console.log(line), minLevel: LogLevel = "info") {
    this.sink = sink;
    this.minLevel = minLevel;
  }

  nextCorrelationId(): string {
    this.correlationCounter += 1;
    return `corr-${this.correlationCounter}`;
  }

  log(level: LogLevel, msg: string, fields: LogFields = {}): void {
    if (LEVEL_ORDER[this.minLevel] > LEVEL_ORDER[level]) return;
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      safe[k] = typeof v === "string" ? redact(v) : v;
    }
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      msg: redact(msg),
      ...safe,
    });
    this.sink(line);
  }

  debug(msg: string, fields?: LogFields): void {
    this.log("debug", msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.log("info", msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.log("warn", msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.log("error", msg, fields);
  }
}


