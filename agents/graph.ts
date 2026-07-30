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

import { END, START, StateGraph } from "@langchain/langgraph";
import type { CompiledStateGraph } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import { buildAgentTools } from "@/agents/tools";
import { buildLlmNode, buildToolNode, shouldContinue } from "@/agents/nodes";
import { AgentState } from "@/agents/state";
import { loadAppConfig, loadDatabaseConfig } from "@/lib/aws/app-config";
import { container } from "@/lib/container";
import { createNeonPool } from "@/lib/neon";

/**
 * The checkpointer, created once per process and its tables ensured once.
 *
 * MemorySaver used to live here, which was fine for a single long-lived
 * server and wrong for this deployment: on Vercel every Lambda instance
 * holds its own memory, instances come and go between requests, and a
 * conversation resumed on a different instance found no checkpoint at all.
 * Postgres is the only thing all instances share.
 *
 * `.setup()` is idempotent (CREATE TABLE IF NOT EXISTS), but it is still
 * DDL, so it is awaited exactly once per process rather than per turn.
 * The checkpoint tables land in the default search_path, not the
 * `agricultural` schema — they are LangGraph's own infrastructure, not
 * domain data, and keeping them out of the domain schema means a
 * `sql/` rebuild never has an opinion about them.
 */
async function buildCheckpointer(): Promise<PostgresSaver> {
  const database = await loadDatabaseConfig();
  // The pooled URL, deliberately. These are short per-turn reads and
  // writes from many concurrent instances — exactly the traffic Neon's
  // pooler exists for, and non-pooled connections would exhaust the
  // instance budget long before the pooled ones did.
  //
  // Our own pool rather than PostgresSaver.fromConnString: that helper
  // builds a node-postgres pool, which reaches Postgres over plain TCP
  // on :5432. Neon's Pool is API-compatible and speaks the WebSocket
  // transport the rest of the app already uses, so there is one way in
  // instead of two.
  //
  // The cast targets PostgresSaver's own parameter type rather than an
  // imported `pg.Pool`, so this file needs neither `pg` nor @types/pg to
  // say what it means.
  const pool = createNeonPool(
    database.url,
  ) as unknown as ConstructorParameters<typeof PostgresSaver>[0];
  const saver = new PostgresSaver(pool);
  await saver.setup();
  return saver;
}

const globalForCheckpointer = globalThis as typeof globalThis & {
  __agentCheckpointer?: Promise<PostgresSaver>;
};

function getCheckpointer(): Promise<PostgresSaver> {
  globalForCheckpointer.__agentCheckpointer ??= buildCheckpointer().catch(
    (error: unknown) => {
      globalForCheckpointer.__agentCheckpointer = undefined;
      throw error;
    },
  );
  return globalForCheckpointer.__agentCheckpointer;
}

export function buildAgentGraph(
  config: Awaited<ReturnType<typeof loadAppConfig>>,
  checkpointer: PostgresSaver,
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

  return graph.compile({ checkpointer });
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

  const building = Promise.all([loadAppConfig(), getCheckpointer()])
    .then(([config, checkpointer]) => buildAgentGraph(config, checkpointer))
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
