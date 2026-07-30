// ============================================================
// app/dashboard/assistant/conversation-list.tsx
//
// The conversation switcher.
//
// Every entry is a plain <Link> to ?thread=<id> rather than a click
// handler, because the thread id already lives in the URL — so
// switching is just navigation, and back/forward, middle-click and
// bookmarking all work for free.
//
// A Server Component: the list comes from Postgres and is scoped to the
// signed-in user by the query itself, so no conversation belonging to
// anyone else can reach the client to begin with.
// ============================================================

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/schemas";

import { deleteConversation } from "./actions";

export function ConversationList({
  conversations,
  activeThreadId,
}: {
  conversations: ConversationSummary[];
  activeThreadId: string;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Conversations</h2>
        {/*
          A link to the bare page, not to a freshly minted id: the page
          mints one and redirects, so there is exactly one place that
          decides what a new thread id looks like.
        */}
        <Link
          href="/dashboard/assistant"
          className={buttonVariants({ size: "sm", variant: "outline" })}
        >
          New
        </Link>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {conversations.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            No conversations yet. Ask something to start one.
          </p>
        ) : (
          <ul className="space-y-1 pr-2">
            {conversations.map((conversation) => {
              const active = conversation.id === activeThreadId;
              return (
                <li key={conversation.id} className="group relative">
                  <Link
                    href={`/dashboard/assistant?thread=${conversation.id}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 pr-8 text-sm transition-colors",
                      active
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                    )}
                  >
                    <span className="line-clamp-2 break-words">
                      {conversation.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] opacity-70 tabular-nums">
                      {conversation.relative_age} ·{" "}
                      {Math.floor(conversation.message_count / 2)} turns
                    </span>
                  </Link>

                  <form
                    action={deleteConversation}
                    className="absolute top-1 right-1"
                  >
                    <input type="hidden" name="threadId" value={conversation.id} />
                    <button
                      type="submit"
                      aria-label={`Delete conversation: ${conversation.title}`}
                      className="rounded p-1 text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100 focus-visible:opacity-100"
                    >
                      ✕
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
