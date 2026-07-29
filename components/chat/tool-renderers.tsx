"use client";

// ============================================================
// components/chat/tool-renderers.tsx
//
// Renders each agent tool call inline in the transcript: what was asked,
// whether it is still running, and — once it finishes — the chart or
// table built from its structured artifact.
//
// WHY THE ARTIFACT IS FETCHED FROM AGENT STATE, NOT FROM `result`
//
// A renderer is handed `{ name, args, status, result }`, and `result` is
// typed `string` — the tool's prose. That is the model's view, and it is
// the wrong shape for a chart. Regex-ing numbers back out of
// "Predicted price : $253.26/tonne" would work right up until someone
// reformats that string, then fail silently with a plausible-looking
// chart.
//
// So the bridge puts the structured payload in agent STATE, keyed by
// tool-call id (see agents/agui-agent.ts), and each renderer looks
// itself up by the one handle it is given. When no artifact is present
// — an error path, a no-data path, a tool still running — the prose is
// shown instead, which is always truthful because it is exactly what the
// model was told.
// ============================================================

import { ToolCallStatus, useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import { defineToolCallRenderer } from "@copilotkit/react-core/v2";
import { z } from "zod";

import { asToolArtifact } from "@/agents/artifacts";
import type { AgentUiState } from "@/agents/agui-agent";
import { ArtifactCard } from "@/components/chat/artifact-cards";

const LABELS: Record<string, string> = {
  list_available_crops: "Checking what data exists",
  search_agronomic_knowledge: "Searching the knowledge base",
  get_crop_price_history: "Reading price history",
  predict_crop_price: "Running the forecast model",
  get_weather_outlook: "Fetching weather",
  get_market_indicators: "Reading market indicators",
};

function Spinner() {
  return (
    <span
      className="inline-block size-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
      aria-hidden
    />
  );
}

/**
 * The shared shell: a status line naming the tool, then the artifact.
 *
 * `args` is rendered as a compact summary rather than raw JSON — the
 * point is to make the agent's reasoning legible to someone who does
 * not know the tool signatures.
 */
function ToolCallShell({
  name,
  toolCallId,
  running,
  summary,
  result,
}: {
  name: string;
  toolCallId: string;
  running: boolean;
  summary: string;
  result: string | undefined;
}) {
  // subscribing to state changes so the card appears the moment the
  // bridge emits its STATE_SNAPSHOT, without waiting for the next token
  const { agent } = useAgent({ updates: [UseAgentUpdate.OnStateChanged] });
  const state = agent.state as Partial<AgentUiState> | undefined;
  const artifact = asToolArtifact(state?.artifacts?.[toolCallId]);

  return (
    <div className="my-2 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {running ? <Spinner /> : <span aria-hidden>✓</span>}
        <span>{LABELS[name] ?? name}</span>
        {summary && (
          <span className="truncate font-mono text-xs opacity-70">{summary}</span>
        )}
      </div>

      {artifact ? (
        <ArtifactCard artifact={artifact} />
      ) : (
        // no structured payload: the tool errored, found nothing, or is
        // still running. Showing the prose keeps the transcript honest
        // rather than rendering an empty chart frame.
        !running &&
        result && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            {result}
          </pre>
        )
      )}
    </div>
  );
}

const cropRegion = z.object({
  crop_code: z.string().optional(),
  region_code: z.string().optional(),
});

/**
 * Schemas here are intentionally LOOSER than the tools' own.
 *
 * Args stream in as partial JSON while the model is still emitting
 * them, so a renderer that demanded every required field would throw
 * mid-stream on a half-built object. Every field is optional; the
 * summary line simply shows whatever has arrived.
 */
export const toolRenderers = [
  defineToolCallRenderer({
    name: "list_available_crops",
    args: z.object({}),
    render: ({ toolCallId, status, result }) => (
      <ToolCallShell
        name="list_available_crops"
        toolCallId={toolCallId}
        running={status !== ToolCallStatus.Complete}
        summary=""
        result={result}
      />
    ),
  }),

  defineToolCallRenderer({
    name: "get_crop_price_history",
    args: cropRegion.extend({ months_back: z.number().nullish() }),
    render: ({ toolCallId, status, args, result }) => (
      <ToolCallShell
        name="get_crop_price_history"
        toolCallId={toolCallId}
        running={status !== ToolCallStatus.Complete}
        summary={[args.crop_code, args.region_code].filter(Boolean).join(" @ ")}
        result={result}
      />
    ),
  }),

  defineToolCallRenderer({
    name: "predict_crop_price",
    args: cropRegion.extend({ target_date: z.string().optional() }),
    render: ({ toolCallId, status, args, result }) => (
      <ToolCallShell
        name="predict_crop_price"
        toolCallId={toolCallId}
        running={status !== ToolCallStatus.Complete}
        summary={[
          [args.crop_code, args.region_code].filter(Boolean).join(" @ "),
          args.target_date,
        ]
          .filter(Boolean)
          .join(" · ")}
        result={result}
      />
    ),
  }),

  defineToolCallRenderer({
    name: "search_agronomic_knowledge",
    args: z.object({
      query: z.string().optional(),
      crop_code: z.string().nullish(),
    }),
    render: ({ toolCallId, status, args, result }) => (
      <ToolCallShell
        name="search_agronomic_knowledge"
        toolCallId={toolCallId}
        running={status !== ToolCallStatus.Complete}
        summary={args.query ?? ""}
        result={result}
      />
    ),
  }),

  defineToolCallRenderer({
    name: "get_weather_outlook",
    args: z.object({ region_code: z.string().optional() }),
    render: ({ toolCallId, status, args, result }) => (
      <ToolCallShell
        name="get_weather_outlook"
        toolCallId={toolCallId}
        running={status !== ToolCallStatus.Complete}
        summary={args.region_code ?? ""}
        result={result}
      />
    ),
  }),

  defineToolCallRenderer({
    name: "get_market_indicators",
    args: z.object({}),
    render: ({ toolCallId, status, result }) => (
      <ToolCallShell
        name="get_market_indicators"
        toolCallId={toolCallId}
        running={status !== ToolCallStatus.Complete}
        summary=""
        result={result}
      />
    ),
  }),
];
