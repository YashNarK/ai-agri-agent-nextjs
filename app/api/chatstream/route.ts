// ============================================================
// app/api/chatstream/route.ts
//
// POST /api/chatstream — same agent as POST /api/chat, but the answer
// is streamed token-by-token over Server-Sent Events so a UI can render
// it as it is generated.
//
// Event stream
//   token  {"delta": "..."}   a chunk of generated text — append in order
//   tool   {"name": "..."}    the agent started a tool call (transparency)
//   notice {"detail": "..."}  a non-fatal notice (e.g. work budget reached)
//   error  {"detail": "..."}  the run failed
//   done   {"session_id": "...", "message": "<final answer>"}
//
// The same work-budget guardrail as /api/chat applies, so broad questions
// stay bounded and terminate cleanly. Session and messages are persisted
// to PostgreSQL just like the non-streaming route.
//
// Port of routers/chat.py (chat_stream)
// ============================================================

import { HumanMessage } from "@langchain/core/messages";
import { GraphRecursionError } from "@langchain/langgraph";

import { getAgentGraph } from "@/agents/graph";
import { RECURSION_LIMIT } from "@/agents/nodes";
import { chatService } from "@/lib/container";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { chatRequestSchema } from "@/lib/schemas";
import { BUDGET_FALLBACK, chunkText } from "@/services/chat.service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const parsed = chatRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0].message);
    }

    const { message, session_id, user_id } = parsed.data;

    // session bootstrap happens before the stream opens, so a DB failure
    // surfaces as a normal error response rather than mid-stream
    const sessionId = await chatService.ensureSession(session_id, user_id);
    const graph = await getAgentGraph();

    const encoder = new TextEncoder();
    const sse = (event: string, data: unknown) =>
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // `answerParts` holds only the FINAL answer: it is reset whenever a
        // tool runs, so intermediate "let me check…" preambles don't pollute
        // the persisted/echoed answer — while every token is still streamed
        // live.
        let answerParts: string[] = [];
        const toolNames: string[] = [];
        let finalText: string;

        try {
          const events = graph.streamEvents(
            { messages: [new HumanMessage(message)] },
            {
              version: "v2",
              configurable: { thread_id: sessionId },
              recursionLimit: RECURSION_LIMIT,
            },
          );

          for await (const event of events) {
            if (event.event === "on_chat_model_stream") {
              const text = chunkText(event.data?.chunk?.content);
              if (text) {
                answerParts.push(text);
                controller.enqueue(sse("token", { delta: text }));
              }
            } else if (event.event === "on_tool_start") {
              const name = event.name ?? "";
              toolNames.push(name);
              answerParts = [];
              controller.enqueue(sse("tool", { name }));
            }
          }

          finalText = answerParts.join("").trim() || BUDGET_FALLBACK;
        } catch (error) {
          if (error instanceof GraphRecursionError) {
            finalText = answerParts.join("").trim() || BUDGET_FALLBACK;
            controller.enqueue(
              sse("notice", { detail: "work budget reached — stopped early" }),
            );
          } else {
            const detail = error instanceof Error ? error.message : String(error);
            controller.enqueue(sse("error", { detail }));
            controller.close();
            return;
          }
        }

        // persistence must never break the stream
        try {
          await chatService.persistStreamedTurn(
            sessionId,
            message,
            finalText,
            toolNames,
          );
        } catch (error) {
          console.error(
            `failed to persist /chatstream messages for ${sessionId}`,
            error,
          );
        }

        controller.enqueue(sse("done", { session_id: sessionId, message: finalText }));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // stops nginx/proxies from buffering the stream into one blob
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
