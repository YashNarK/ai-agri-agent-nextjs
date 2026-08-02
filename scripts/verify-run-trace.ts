// ============================================================
// scripts/verify-run-trace.ts
//
// Proves the reasoning trace is CAPTURED and PERSISTED, which is the
// thing that did not exist before: the database kept `[{name}]` per
// tool — no arguments, no results — so a reloaded conversation showed
// the answer with no record of how it was reached.
//
// Drives the real AG-UI agent (the same class /api/copilotkit mounts)
// on a throwaway thread, then reads the row back out of Postgres and
// checks the trace against what the run actually did.
//
//   npx tsx scripts/verify-run-trace.ts
// ============================================================

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { AgriculturalAgent } from "@/agents/agui-agent";
import { asRunTrace } from "@/agents/trace";
import { getPrisma } from "@/lib/prisma";

const QUESTION =
  "Forecast the MAIZE price in US-CORN for 2026-11-01. Use the prediction model.";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures.push(name);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const prisma = await getPrisma();

  // Any approved user will do — the agent needs an owner so the turn is
  // written to a session the transcript endpoint will hand back.
  const user = await prisma.app_users.findFirst({
    where: { status: "approved" },
    select: { id: true, email: true },
  });
  if (!user) throw new Error("no approved user to run as");

  const threadId = randomUUID();
  console.log(`thread : ${threadId}`);
  console.log(`as     : ${user.email}\n`);

  const agent = new AgriculturalAgent({ userId: user.id });

  console.log("running the agent (this makes real model + Lambda calls)…");
  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    agent
      .run({
        threadId,
        runId: randomUUID(),
        messages: [{ id: randomUUID(), role: "user", content: QUESTION }],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      } as never)
      .subscribe({
        next: () => {},
        error: reject,
        complete: resolve,
      });
  });
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  // -- read it back from the database, not from memory ----------------
  const rows = await prisma.chat_messages.findMany({
    where: { session_id: threadId },
    orderBy: { created_at: "asc" },
  });

  console.log("== persisted ==");
  check("both turn halves written", rows.length === 2, `${rows.length} rows`);

  const ai = rows.find((r) => r.role === "ai");
  if (!ai) {
    console.log("\nFAILED: no ai row");
    process.exit(1);
  }

  // -- tool_calls now carries ARGUMENTS -------------------------------
  const toolCalls = (ai.tool_calls ?? []) as { name?: string; args?: unknown }[];
  check("tool_calls recorded", toolCalls.length > 0, `${toolCalls.length}`);
  check(
    "tool_calls carry args (previously name-only)",
    toolCalls.some((c) => c.args && Object.keys(c.args).length > 0),
    JSON.stringify(toolCalls[0] ?? {}).slice(0, 110),
  );

  // -- tool_results now carries the trace -----------------------------
  console.log("\n== trace ==");
  const trace = asRunTrace(ai.tool_results);
  check("tool_results holds a v1 trace (column was never written before)", !!trace);
  if (!trace) {
    console.log("\nFAILURES: " + failures.join(", "));
    process.exit(1);
  }

  check("has steps", trace.steps.length > 0, `${trace.steps.length}`);
  check(
    "steps are contiguously indexed",
    trace.steps.every((s, i) => s.index === i),
  );
  check("records run duration", trace.duration_ms > 0, `${trace.duration_ms}ms`);
  check(
    "records budget",
    trace.tool_call_budget > 0,
    `${trace.tool_calls_used}/${trace.tool_call_budget}`,
  );

  const tools = trace.steps.filter((s) => s.kind === "tool");
  const texts = trace.steps.filter((s) => s.kind === "text");
  check("captured tool steps", tools.length > 0, `${tools.length}`);
  check("captured reasoning prose steps", texts.length > 0, `${texts.length}`);
  check(
    "every tool step has BOTH input and output",
    tools.every((s) => s.args !== undefined && (s.output ?? "") !== ""),
  );
  check("tool steps timed", tools.every((s) => (s.duration_ms ?? 0) >= 0));
  check(
    "final prose step labelled as the answer",
    texts[texts.length - 1]?.name === "answer",
    texts[texts.length - 1]?.name,
  );
  check(
    "forecast step captured with its artifact",
    tools.some((s) => s.name === "predict_crop_price" && !!s.artifact_kind),
    tools.map((s) => `${s.name}${s.artifact_kind ? `→${s.artifact_kind}` : ""}`).join(", "),
  );

  console.log("\n== the run, as the accordion will show it ==");
  for (const step of trace.steps) {
    const label = `${step.index + 1}. ${step.name}`;
    const io =
      step.kind === "tool"
        ? `in=${JSON.stringify(step.args)} out=${(step.output ?? "").slice(0, 60).replace(/\n/g, " ")}…`
        : `${(step.output ?? "").slice(0, 70).replace(/\n/g, " ")}…`;
    console.log(`  ${step.ok ? "✓" : "✕"} ${label.padEnd(28)} ${io}`);
  }

  // -- and it survives the transcript round trip ----------------------
  console.log("\n== transcript replay ==");
  const { chatService } = await import("@/lib/container");
  const transcript = await chatService.getTranscript(threadId, user.id);
  const assistant = transcript.messages.find((m) => m.role === "assistant");
  check("transcript returns the assistant turn", !!assistant);
  check(
    "transcript carries the trace for replay after reload",
    !!asRunTrace(assistant?.trace),
  );

  // -- clean up the throwaway thread ----------------------------------
  await prisma.chat_sessions.delete({ where: { id: threadId } }).catch(() => {});

  console.log(
    failures.length === 0 ? "\nALL PASSED" : `\nFAILURES: ${failures.join(", ")}`,
  );
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
