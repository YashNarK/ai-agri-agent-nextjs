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
//
// This is the assistant's real entry point — the chat UI talks here, not
// to /api/chat — so it carries the same approval guard as the REST chat
// routes. Guarding the page alone would leave the expensive part open.
// ============================================================

import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import { AgriculturalAgent } from "@/agents/agui-agent";
import { requireApprovedApi } from "@/lib/auth/guard";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";
// the agent holds DB and Azure connections and streams for tens of
// seconds; nothing here is cacheable
export const dynamic = "force-dynamic";

/**
 * Builds a runtime bound to one specific user.
 *
 * Per request rather than once at module scope, because the agent now
 * carries the viewer's id: a shared instance would file every user's
 * conversation under whoever happened to load the module first.
 *
 * The factory inside also stays per-run — AbstractAgent holds mutable
 * per-run state (messages, isRunning), so one instance serving
 * concurrent requests would let two turns tread on each other.
 */
const runtimeFor = (userId: string) =>
  new CopilotRuntime({
    agents: () => ({ agricultural: new AgriculturalAgent({ userId }) }),
  });

async function handle(request: Request): Promise<Response> {
  try {
    const viewer = await requireApprovedApi();

    const handler = createCopilotRuntimeHandler({
      runtime: runtimeFor(viewer.id),
      basePath: "/api/copilotkit",
    });

    return await handler(request);
  } catch (error) {
    // requireApprovedApi throws ApiError; everything else is a genuine
    // 500. Either way the client gets JSON rather than a stream that
    // dies on its first event.
    return toErrorResponse(error);
  }
}

export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
