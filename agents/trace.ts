// ============================================================
// agents/trace.ts
//
// The record of ONE LangGraph run: every step the agent took, in
// order, with the input it was given and the output it produced.
//
// WHY THIS EXISTS
//
// The transcript shows the answer. It does not show how the answer was
// reached, and for an agent that reads a database and scores a model
// that is the part worth auditing — a forecast quoted without the tool
// call behind it is indistinguishable from one the model invented.
//
// Tool cards already render inline DURING a live run. They vanish on
// reload: the run's events are gone, and the database kept only
// `[{name}]` per tool — no arguments, no results. So a conversation
// looked fully reasoned while it was happening and completely
// unexplained a minute later. This is the shape that closes that gap,
// persisted per turn and replayed with it.
//
// Deliberately dependency-free and free of "use client": the bridge
// writes it on the server, the accordion reads it on the client.
// ============================================================

/** One step of the run: a tool invocation, or a stretch of the model's prose. */
export interface RunStep {
  /** Position in the run, 0-based — the order things actually happened. */
  index: number;
  /**
   * `tool` — the agent called a tool.
   * `text` — the model wrote prose. Interleaved deliberately: "I'll check
   *          what data exists first" is reasoning, and dropping it would
   *          leave the tool calls looking unmotivated.
   */
  kind: "tool" | "text";
  /** Tool name, or "reasoning"/"answer" for prose. */
  name: string;
  /** Tool arguments, exactly as the model supplied them. Absent for prose. */
  args?: Record<string, unknown>;
  /**
   * What came back — the tool's prose result, or the model's text.
   *
   * Truncated on write: a price-history tool can return hundreds of
   * rows, and this lands in a JSON column read on every transcript
   * load. `output_truncated` says when that happened rather than
   * letting the reader assume they are seeing everything.
   */
  output?: string;
  output_truncated?: boolean;
  /** Set when the tool returned a structured payload (a chart, a table). */
  artifact_kind?: string;
  /** False when the tool threw or reported no data. */
  ok: boolean;
  duration_ms?: number;
}

export interface RunTrace {
  /** Schema version, so an old row can be rendered or skipped knowingly. */
  v: 1;
  run_id: string;
  steps: RunStep[];
  tool_calls_used: number;
  tool_call_budget: number;
  budget_exhausted: boolean;
  duration_ms: number;
}

/**
 * Longest tool output kept per step.
 *
 * Enough for every tool's summary prose, short of the ones that return
 * a long table. The accordion shows what is stored and says when it was
 * cut; the alternative — storing everything — makes the transcript
 * query grow without bound for output nobody reads in full.
 */
export const MAX_STEP_OUTPUT_CHARS = 4000;

export function truncateStepOutput(text: string): {
  output: string;
  truncated: boolean;
} {
  if (text.length <= MAX_STEP_OUTPUT_CHARS) {
    return { output: text, truncated: false };
  }
  return {
    output: text.slice(0, MAX_STEP_OUTPUT_CHARS),
    truncated: true,
  };
}

/**
 * Narrows an unknown JSON column to a RunTrace.
 *
 * The value comes back from Postgres as `unknown`, and rows written
 * before this existed hold `null` or an older shape — both must render
 * as "no trace" rather than throwing inside a transcript fetch.
 */
export function asRunTrace(value: unknown): RunTrace | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return null;
  if (!Array.isArray(record.steps)) return null;
  return value as RunTrace;
}

/** Human-readable label for a step, shared by the accordion and tests. */
export const STEP_LABELS: Record<string, string> = {
  list_available_crops: "Checked what data exists",
  search_agronomic_knowledge: "Searched the knowledge base",
  get_crop_price_history: "Read price history",
  predict_crop_price: "Ran the forecast model",
  get_weather_outlook: "Fetched weather",
  get_market_indicators: "Read market indicators",
  reasoning: "Reasoning",
  answer: "Wrote the answer",
};
