// ============================================================
// agents/nodes.ts
//
// The LLM node, the tool node, and the loop router.
//
// Port of agents/nodes.py
// ============================================================

import {
  AIMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AzureChatOpenAI } from "@langchain/openai";

import type { AzureOpenAIConfig } from "@/lib/aws/app-config";
import type { AgentStateType } from "@/agents/state";

/**
 * Recovers a tool-call arguments object from a malformed JSON string.
 *
 * DeepSeek-V3.2 (and some other Azure-served models) emit tool-call
 * arguments with trailing junk, e.g. `{}""` or `{"crop_code":"MAIZE"}""`
 * — valid JSON followed by an extra `""`. A strict JSON.parse throws, so
 * LangChain files the call under `invalid_tool_calls` and leaves
 * `.tool_calls` empty, which stalls the ReAct loop.
 *
 * We scan for the longest valid JSON object prefix and ignore trailing
 * characters. Returns the object on success, or null if nothing usable
 * can be recovered.
 */
export function salvageToolArgs(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;

  const text = raw.trim();
  if (text === "") return {};

  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // fall through to the prefix scan
  }

  // JS has no `raw_decode`, so walk the string tracking brace depth
  // (ignoring braces inside string literals) and parse the first
  // balanced object.
  if (!text.startsWith("{")) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(0, i + 1));
          return typeof parsed === "object" && parsed !== null
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

/**
 * Promotes salvageable `invalid_tool_calls` into real `tool_calls`.
 *
 * No-op for well-behaved models; only rebuilds the message when there is
 * something to recover. The repaired tool_calls carry clean object args,
 * so both ToolNode dispatch and the next outbound API request serialise
 * correctly.
 */
export function repairToolCalls(message: AIMessage): AIMessage {
  const invalid = message.invalid_tool_calls ?? [];
  if (invalid.length === 0) return message;

  const salvaged: NonNullable<AIMessage["tool_calls"]> = [];
  const stillInvalid: typeof invalid = [];

  for (const itc of invalid) {
    const args = salvageToolArgs(itc.args);
    if (args !== null && itc.name) {
      salvaged.push({
        name: itc.name,
        args,
        id: itc.id,
        type: "tool_call",
      });
    } else {
      stillInvalid.push(itc);
    }
  }

  if (salvaged.length === 0) return message;

  return new AIMessage({
    id: message.id,
    name: message.name,
    content: message.content,
    tool_calls: [...(message.tool_calls ?? []), ...salvaged],
    invalid_tool_calls: stillInvalid,
    additional_kwargs: message.additional_kwargs,
    response_metadata: message.response_metadata,
    usage_metadata: message.usage_metadata,
  });
}

export const SYSTEM_PROMPT = `You are an expert agricultural intelligence assistant for
a global leader in agricultural science and crop protection.

You help farmers, agronomists and agricultural professionals with:
- Crop price analysis and predictions
- Agronomic best practices and crop management advice
- Pest and disease identification and management
- Market intelligence and price trend analysis

You have access to the following tools:
- list_available_crops       : ALWAYS call this first to discover valid crop_code
                               and region_code values before calling any other tool
- search_agronomic_knowledge : Search the agronomic knowledge base
- get_crop_price_history     : Retrieve historical price data
- predict_crop_price         : Predict future prices using the Azure ML model
                               For multi-year forecasts call once per year with
                               mid-year dates e.g. 2025-06-01, 2026-06-01 etc.
- get_weather_outlook        : Get weather and drought data for a region
- get_market_indicators      : Get macro market indicators

IMPORTANT RULES:
1. ALWAYS call list_available_crops first. It returns the valid crop codes,
   region codes, and — critically — the exact (crop @ region) pairs that have
   price data. Treat it as the single source of truth.
2. Never guess or invent crop_code or region_code values. Never assume a region
   for a crop (e.g. do NOT assume Texas crops live under US-CORN). Texas maps to
   region code US-SOUTH.
3. get_crop_price_history and predict_crop_price ONLY work for the pairs listed
   by list_available_crops. Do not call them for other pairs, and never fabricate
   a price or forecast for a pair that has no data.
4. For multi-year price forecasts, call predict_crop_price once per year.
5. Base every number in your answer on a value actually returned by a tool. If a
   tool returns an error, "no data", or "NO FORECAST AVAILABLE", report that
   plainly for that crop — do NOT substitute an estimate, a memory, or a value
   from another crop/region.
6. When the user asks for the "top N" or "highest" crops by projected value, only
   rank crops for which predict_crop_price actually succeeded. If fewer than N
   have data, say so explicitly and list only the ones you could forecast, plus
   which requested crops lack data and why.
7. Be transparent about gaps: end with a short "Data availability" note stating
   exactly which crops/regions could and could not be forecast.
8. Be precise with agronomic advice — wrong advice can cost farmers their harvest.
9. WORK BUDGET — self-assess scope before acting. You have a limited tool-call
   budget per turn (roughly 5-6 tool calls). Do NOT try to forecast every crop or
   every region. When a request is broad ("rank ALL drought-resistant crops",
   "every region", "order everything by price"), FIRST narrow it to the most
   relevant small set — e.g. pick 3-5 candidate crops in ONE region — and say so
   explicitly up front, e.g. "This is a broad request; to stay accurate I'll
   analyse these N crops in <region> now." Prefer depth on a focused set over
   shallow coverage of everything.
10. If you cannot finish everything within budget, still deliver a COMPLETE answer
    for the subset you did cover, clearly list what you deferred and why, and
    invite the user to ask a follow-up to continue with the rest. Never stall,
    loop endlessly, or pad the answer with guesses to appear complete.
`;

// --------------------------------------------------------------------------
// Guardrail constants — bound the ReAct loop so a broad question can never
// hang or crash the request. MAX_AGENT_TOOL_CALLS is a hard cap on how many
// tool calls the agent may make in a single turn; RECURSION_LIMIT is a
// belt-and-suspenders backstop on total graph super-steps (used by the route).
// --------------------------------------------------------------------------
export const MAX_AGENT_TOOL_CALLS = 8;
export const RECURSION_LIMIT = 30;

/**
 * Injected when the tool-call budget is exhausted. The final LLM hop runs
 * with tools DISABLED, so the model must answer now and the loop always
 * terminates.
 */
export const TOOL_BUDGET_NOTICE =
  "SYSTEM NOTICE: You have now used your entire tool-call budget for this turn. " +
  "Do NOT request any more tools — none are available on this step. Using ONLY " +
  "the data already gathered above, write your final answer now. Be explicit " +
  "that you limited scope to stay within your work budget: state which " +
  "crops/regions you analysed and which you deferred, and invite the user to " +
  "ask a follow-up so you can continue with the rest.";

/**
 * True for any assistant message, whether it arrived as an AIMessage or
 * an AIMessageChunk.
 *
 * This distinction is load-bearing, not pedantic. The chat model runs
 * with `streaming: true`, so `invoke()` aggregates the stream and hands
 * back an **AIMessageChunk** — and AIMessageChunk does NOT extend
 * AIMessage. An `instanceof AIMessage` test therefore returns false for
 * a perfectly normal assistant turn, which silently ends the ReAct loop
 * while a tool call is still pending.
 *
 * That failure is invisible from the outside: the run "succeeds" and
 * returns the model's preamble ("let me check…") as if it were the
 * answer. Comparing the message TYPE is stable across both shapes.
 */
export function isAiMessage(message: BaseMessage): boolean {
  return message.getType() === "ai";
}

/** Assistant messages carry tool_calls; the base type does not declare it. */
function toolCallsOf(message: BaseMessage) {
  return (message as AIMessage).tool_calls ?? [];
}

/** Total tool calls the agent has already made this turn. */
function countToolCalls(messages: BaseMessage[]): number {
  return messages.reduce(
    (total, msg) => (isAiMessage(msg) ? total + toolCallsOf(msg).length : total),
    0,
  );
}

/**
 * LangChain JS builds Azure URLs from a *deployments* base path, whereas
 * the Python SDK takes the bare resource endpoint. Normalising here lets
 * the same secret value serve both apps unchanged.
 */
function toDeploymentsBasePath(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  return trimmed.endsWith("/openai/deployments")
    ? trimmed
    : `${trimmed}/openai/deployments`;
}

export function buildLlmNode(
  config: AzureOpenAIConfig,
  tools: StructuredToolInterface[],
) {
  // streaming:true so the /chatstream SSE route can emit tokens as they
  // are generated; invoke() transparently aggregates the stream.
  const baseLlm = new AzureChatOpenAI({
    azureOpenAIApiKey: config.chatApiKey,
    azureOpenAIApiDeploymentName: config.chatModelName,
    azureOpenAIApiVersion: config.chatApiVersion,
    azureOpenAIBasePath: toDeploymentsBasePath(config.chatEndpoint),
    temperature: 0.1,
    streaming: true,
  });

  const llmWithTools = baseLlm.bindTools(tools);

  return async function llmNode(state: AgentStateType) {
    let messages: BaseMessage[] = [...state.messages];

    if (messages.length === 0 || !(messages[0] instanceof SystemMessage)) {
      messages = [new SystemMessage(SYSTEM_PROMPT), ...messages];
    }

    let response: AIMessage;
    if (countToolCalls(messages) >= MAX_AGENT_TOOL_CALLS) {
      // Budget exhausted — force the model to finalise. Running WITHOUT
      // tools bound guarantees the next message has no tool_calls, so
      // shouldContinue routes to END and the loop can never run away.
      response = (await baseLlm.invoke([
        ...messages,
        new SystemMessage(TOOL_BUDGET_NOTICE),
      ])) as AIMessage;
    } else {
      response = (await llmWithTools.invoke(messages)) as AIMessage;
    }

    // Salvage malformed tool-call args before routing/dispatch.
    return { messages: [repairToolCalls(response)] };
  };
}

export function shouldContinue(state: AgentStateType): "tools" | "end" {
  const messages = state.messages;
  if (messages.length === 0) return "end";

  // isAiMessage rather than `instanceof AIMessage`: with streaming on,
  // the aggregated response is an AIMessageChunk, and instanceof would
  // route a pending tool call straight to END.
  const last = messages[messages.length - 1];
  if (isAiMessage(last) && toolCallsOf(last).length > 0) {
    return "tools";
  }
  return "end";
}

export function buildToolNode(tools: StructuredToolInterface[]): ToolNode {
  return new ToolNode(tools);
}
