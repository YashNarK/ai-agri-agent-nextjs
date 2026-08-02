"use client";

// ============================================================
// components/chat/reasoning-accordion.tsx
//
// The collapsed record of one LangGraph run, shown above the answer it
// produced. Expanding it reveals every step in order — what the agent
// called, the arguments it chose, and what came back.
//
// WHY COLLAPSED BY DEFAULT
//
// The steps are evidence, not the reply. Someone reading the answer
// wants the answer; someone checking whether a quoted forecast came
// from the model or from the model's imagination wants all of it. A
// summary line carries the first ("4 steps · 2 tools · 3.1s") and the
// disclosure carries the second.
//
// WHY ARGUMENTS AND OUTPUTS ARE BOTH SHOWN
//
// Either alone is unfalsifiable. "Ran the forecast model" could be any
// crop, any date; the arguments say which. And an argument list without
// the result cannot tell you whether the tool refused — the tools here
// report failure in their PROSE, so a step can succeed mechanically and
// still have returned "NO FORECAST AVAILABLE".
// ============================================================

import { useState } from "react";

import { STEP_LABELS, type RunStep, type RunTrace } from "@/agents/trace";
import { cn } from "@/lib/utils";

/** "1.4s", "820ms" — precision that matches what the number is used for. */
function duration(ms: number | undefined): string | null {
  if (ms === undefined) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/**
 * Arguments on one line, as `key: value` pairs.
 *
 * Not JSON.stringify: `{"crop_code":"RICE","region_code":"US-SOUTH"}` is
 * noisier than `crop_code: RICE · region_code: US-SOUTH` and no more
 * informative at this size. Objects and arrays fall back to JSON, which
 * is rare — the tool schemas are flat.
 */
function formatArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const parts = Object.entries(args)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => {
      const rendered =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      return `${key}: ${rendered}`;
    });
  return parts.join("  ·  ");
}

function StepRow({ step }: { step: RunStep }) {
  const label = STEP_LABELS[step.name] ?? step.name;
  const args = formatArgs(step.args);
  const took = duration(step.duration_ms);

  return (
    <li className="border-l-2 border-border pl-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span
          aria-hidden
          className={cn(
            "text-xs",
            step.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
          )}
        >
          {step.ok ? "✓" : "✕"}
        </span>
        <span className="text-xs font-medium">
          {step.index + 1}. {label}
        </span>
        {step.kind === "tool" && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {step.name}
          </span>
        )}
        {step.artifact_kind && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {step.artifact_kind}
          </span>
        )}
        {took && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {took}
          </span>
        )}
      </div>

      {args && (
        <div className="mt-1">
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
            Input
          </span>
          <pre className="mt-0.5 overflow-x-auto rounded bg-muted/60 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap">
            {args}
          </pre>
        </div>
      )}

      {step.output && (
        <div className="mt-1">
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
            {step.kind === "tool" ? "Output" : "Text"}
          </span>
          <pre className="mt-0.5 max-h-56 overflow-auto rounded bg-muted/60 px-2 py-1 text-[11px] whitespace-pre-wrap text-muted-foreground">
            {step.output}
            {step.output_truncated && (
              <span className="mt-1 block text-[10px] italic opacity-70">
                … truncated for storage
              </span>
            )}
          </pre>
        </div>
      )}
    </li>
  );
}

export function ReasoningAccordion({
  trace,
  running = false,
}: {
  trace: RunTrace | { steps: RunStep[]; duration_ms?: number };
  /** A run still in flight: the summary counts what has happened so far. */
  running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const steps = trace.steps ?? [];

  // Nothing to disclose yet. Rendering an empty accordion would promise
  // detail the run has not produced.
  if (steps.length === 0) return null;

  const toolSteps = steps.filter((s) => s.kind === "tool");
  const failed = steps.filter((s) => !s.ok).length;
  const took = duration(trace.duration_ms);

  const summary = [
    `${steps.length} step${steps.length === 1 ? "" : "s"}`,
    toolSteps.length > 0 &&
      `${toolSteps.length} tool call${toolSteps.length === 1 ? "" : "s"}`,
    failed > 0 && `${failed} failed`,
    !running && took,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    // min-h-0 so this can be a flex child that SHRINKS. Without it a
    // flex item refuses to go below its content height, which is what
    // pushed the expanded list past the pane and out of reach.
    <div className="my-2 flex min-h-0 flex-col rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // shrink-0 keeps the header visible while the list below scrolls
        className="flex w-full shrink-0 items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <span
          aria-hidden
          className={cn("transition-transform", open && "rotate-90")}
        >
          ▶
        </span>
        <span className="font-medium">
          {running ? "Working…" : "How this answer was reached"}
        </span>
        <span className="tabular-nums opacity-70">{summary}</span>
        {failed > 0 && (
          <span className="ml-auto text-destructive">needs review</span>
        )}
      </button>

      {open && (
        // The list owns its own scrolling. It sits inside a fixed-height
        // pane whose ancestor is overflow-hidden, so an unbounded list
        // is simply clipped — the steps beyond the fold cannot be
        // reached by scrolling anything, which is exactly how this
        // failed. Capped in vh rather than px so a long trace stays
        // usable on a laptop and a phone alike.
        <ol className="max-h-[45vh] min-h-0 space-y-3 overflow-y-auto overscroll-contain px-3 pt-1 pb-3">
          {steps.map((step) => (
            <StepRow key={step.index} step={step} />
          ))}
        </ol>
      )}
    </div>
  );
}
