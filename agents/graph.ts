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

/** Returns the compiled graph, building it (and loading config) on first use. */
export function getAgentGraph(): Promise<CompiledAgentGraph> {
  globalForGraph.__agentGraph ??= loadAppConfig()
    .then(buildAgentGraph)
    .catch((error: unknown) => {
      globalForGraph.__agentGraph = undefined;
      throw error;
    });
  return globalForGraph.__agentGraph;
}

export type { CompiledStateGraph };
