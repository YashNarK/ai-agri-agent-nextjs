// ============================================================
// app/api/copilotkit/[[...rest]]/route.ts
//
// The CopilotKit runtime endpoint, backed by our AG-UI agent.
//
// A CATCH-ALL SEGMENT, not a single route: the v2 runtime is multi-route
// by default — POST /agent/:agentId/run, GET /info and friends — so a
// plain app/api/copilotkit/route.ts would 404 everything except the bare
// path. `basePath` tells the handler which prefix to strip before
// matching the remainder.
//
// NO SERVICE ADAPTER. v1 required one (the docs' ExperimentalEmptyAdapter
// dance) because the runtime owned the LLM call. In v2 the runtime just
// routes to agents, and OUR agent owns the model — Azure OpenAI, inside
// LangGraph. So there is nothing to adapt.
// ============================================================

import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import { AgriculturalAgent } from "@/agents/agui-agent";

export const runtime = "nodejs";
// the agent holds DB and Azure connections and streams for tens of
// seconds; nothing here is cacheable
export const dynamic = "force-dynamic";

// A factory rather than a shared instance. AbstractAgent carries
// per-run mutable state (messages, isRunning), so one instance serving
// concurrent requests would let two users' turns tread on each other.
const copilotRuntime = new CopilotRuntime({
  agents: () => ({ agricultural: new AgriculturalAgent() }),
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
