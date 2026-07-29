// ============================================================
// agents/graph.ts
//
// Compiles the ReAct graph:  llm → (tools → llm)* → END
//
// FastAPI compiled the graph once in its lifespan and stashed it on
// app.state. Route handlers have no lifespan, so it is memoised here
// behind a promise — same "compile once, reuse" behaviour, resolved on
// the first chat request rather than at boot.
//
// Port of agents/graph.py
// ============================================================

import { MemorySaver, END, START, StateGraph } from "@langchain/langgraph";
import type { CompiledStateGraph } from "@langchain/langgraph";

import { buildAgentTools } from "@/agents/tools";
import { buildLlmNode, buildToolNode, shouldContinue } from "@/agents/nodes";
import { AgentState } from "@/agents/state";
import { loadAppConfig } from "@/lib/aws/app-config";
import { container } from "@/lib/container";

export function buildAgentGraph(
  config: Awaited<ReturnType<typeof loadAppConfig>>,
) {
  // build real tools with DB + config access
  const tools = buildAgentTools(container, config);

  const llmNode = buildLlmNode(config.azureOpenAI, tools);
  const toolNode = buildToolNode(tools);

  const graph = new StateGraph(AgentState)
    .addNode("llm", llmNode)
    .addNode("tools", toolNode)
    .addEdge(START, "llm")
    .addConditionalEdges("llm", shouldContinue, {
      tools: "tools",
      end: END,
    })
    .addEdge("tools", "llm");

  // MemorySaver keeps per-thread history for the lifetime of the
  // server process, matching the Python app's in-memory checkpointer.
  // Swap for a Postgres checkpointer if you need it to survive restarts.
  const memory = new MemorySaver();
  return graph.compile({ checkpointer: memory });
}

type CompiledAgentGraph = ReturnType<typeof buildAgentGraph>;

const globalForGraph = globalThis as typeof globalThis & {
  __agentGraph?: Promise<CompiledAgentGraph>;
};

/**
 * Module-scoped cache, used in development only.
 *
 * The globalThis cache below deliberately outlives module reloads, which
 * is right in production and actively harmful in dev: Next hot-reloads
 * this module on every edit, but a graph parked on globalThis survives,
 * so the process keeps serving the PREVIOUSLY compiled nodes, tools and
 * prompts. Edits to the agent then appear to do nothing — worse, they
 * appear to do something inconsistent, because the stale graph answers
 * while the source says otherwise. That cost a full round of prompt
 * measurements here: the model quoted a string that had already been
 * deleted from the source.
 *
 * A module-level binding is reset by HMR, which is exactly the wanted
 * behaviour. The graph is rebuilt on the next request after an edit;
 * loadAppConfig() is separately memoised, so no secret is re-fetched.
 */
let devGraph: Promise<CompiledAgentGraph> | undefined;

const isDev = process.env.NODE_ENV !== "production";

/** Returns the compiled graph, building it (and loading config) on first use. */
export function getAgentGraph(): Promise<CompiledAgentGraph> {
  const cached = isDev ? devGraph : globalForGraph.__agentGraph;
  if (cached) return cached;

  const building = loadAppConfig()
    .then(buildAgentGraph)
    .catch((error: unknown) => {
      if (isDev) devGraph = undefined;
      else globalForGraph.__agentGraph = undefined;
      throw error;
    });

  if (isDev) devGraph = building;
  else globalForGraph.__agentGraph = building;
  return building;
}

export type { CompiledStateGraph };
