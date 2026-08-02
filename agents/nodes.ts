// ============================================================
// agents/nodes.ts
//
// The LLM node, the tool node, and the loop router.
//
// Port of agents/nodes.py
// ============================================================

import {
  AIMessage,
  HumanMessage,
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
- predict_crop_price         : Predict future prices using the ML price model.
                               Reports a Horizon line: how far past the last
                               ACTUAL observed price the forecast reached.
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
4. FORECAST HORIZON — the model predicts ONE MONTH AHEAD and is rolled forward a
   month at a time to reach anything further out, so error compounds with
   distance. Every predict_crop_price result carries a "Horizon" line saying how
   many months past the last ACTUAL price it reached.
   - ALWAYS state that horizon when you report a forecast. "$639/tonne for
     September 2027, projected 14 months past the last recorded price (July 2026)"
     is honest; "$639/tonne in September 2027" alone is not.
   - The tool REFUSES targets more than 24 months past the last observed price.
     When it refuses, say so and offer a nearer date. Never substitute a nearer
     date's forecast for the one that was refused.
   - NEVER describe two forecasts that came back similar or identical as a trend,
     a plateau, an equilibrium, or price stability. Beyond the data the model has,
     similar outputs are an artefact of extrapolation, not a finding about
     markets. If asked for several future years, report each with its horizon and
     say plainly that confidence falls as the horizon grows.
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
 * Delivered as a trailing user turn when the tool-call budget is spent.
 * The final LLM hop runs with tools DISABLED, so the model must answer
 * now and the loop always terminates — this only shapes the answer.
 *
 * ARRIVED AT BY MEASUREMENT, NOT TASTE — four variants were run against
 * the same budget-exhausting question:
 *
 *   trailing system + "SYSTEM NOTICE:" → full answer, but the model
 *       CONTINUED the message, so answers opened with a stray fragment
 *       of instruction prose
 *   leading system (merged into SYSTEM_PROMPT) → too distant to heed
 *       after eight tool results; the model tried to keep calling tools
 *       and emitted raw <function_calls> XML as prose
 *   trailing user + "SYSTEM NOTICE:" → full answer and guardrail
 *       honoured, but the label invited the model to QUOTE it verbatim
 *   trailing user, softened to "that's enough research" → too weak;
 *       XML leak again, 185-character answer
 *
 * Both working variants kept the explicit "none are available on this
 * step"; both failures softened or distanced it. So that clause stays
 * and only the quotable "SYSTEM NOTICE:" header goes — the smallest
 * edit away from known-good text.
 *
 * The hard guarantee is elsewhere regardless: the final hop binds no
 * tools, so the loop terminates whatever the model does with this.
 */
export const TOOL_BUDGET_NOTICE =
  "You have now used your entire tool-call budget for this turn. Do NOT " +
  "request any more tools — none are available on this step. Using ONLY the " +
  "data already gathered above, write your final answer now. Be explicit " +
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

/**
 * Tool calls the agent has made SINCE THE CURRENT USER MESSAGE.
 *
 * The scope matters and used to be wrong. Counting the whole message
 * list looks equivalent for a one-shot request and is not: the graph is
 * checkpointed per thread, so `state.messages` keeps growing across
 * turns. A first question that spent the full budget left the counter
 * at the cap forever, and every later question in that conversation
 * started already exhausted — the model was handed TOOL_BUDGET_NOTICE
 * before it had done anything, so it answered follow-ups from stale
 * data or, given nothing to say, said nothing at all.
 *
 * MAX_AGENT_TOOL_CALLS is a per-TURN allowance ("your entire tool-call
 * budget for this turn", says the notice), so the count restarts at the
 * last human message.
 */
function countToolCalls(messages: BaseMessage[]): number {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].getType() === "human") {
      start = i;
      break;
    }
  }

  let total = 0;
  for (let i = start; i < messages.length; i += 1) {
    const msg = messages[i];
    if (isAiMessage(msg)) total += toolCallsOf(msg).length;
  }
  return total;
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
      // That is the actual guardrail, and it does not depend on the
      // notice at all — the notice only shapes HOW the model finalises.
      //
      // It is delivered as a trailing HUMAN message, and both halves of
      // that matter. Trailing, because moving it into the leading system
      // message made it too distant to heed: after eight tool results
      // the model ignored it and tried to keep calling tools, emitting
      // raw <function_calls> XML as prose because none were bound.
      // Human rather than system, because a trailing SystemMessage is
      // not addressed to anyone, and the model continued it instead of
      // obeying it — every budget-exhausted answer opened with a stray
      // fragment of instruction text. A user turn is unambiguously
      // "respond to this now", which is exactly the intent.
      //
      // Ephemeral: only `response` is returned into state, so this never
      // enters the conversation or the persisted transcript.
      response = (await baseLlm.invoke([
        ...messages,
        new HumanMessage(TOOL_BUDGET_NOTICE),
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
