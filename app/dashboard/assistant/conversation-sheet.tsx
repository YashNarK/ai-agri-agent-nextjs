"use client";

// ============================================================
// app/dashboard/assistant/conversation-sheet.tsx
//
// The conversation switcher for phones.
//
// On a narrow screen the sidebar is display:none — 260px of permanent
// chrome beside a chat window does not fit. Without this the switcher
// was simply absent below `md`, so a phone user could hold exactly one
// conversation and had no way back to any other.
//
// It renders the same ConversationList as the sidebar rather than a
// parallel implementation, so titles, ages, delete and the active
// highlight cannot drift between the two.
// ============================================================

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { ConversationSummary } from "@/lib/schemas";

import { ConversationList } from "./conversation-list";

export function ConversationSheet({
  conversations,
  activeThreadId,
}: {
  conversations: ConversationSummary[];
  activeThreadId: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Close once the thread actually changes, so the sheet does not sit
  // over the conversation it was just used to open. Adjusted during
  // render rather than in an effect — an effect would paint the open
  // panel over the new conversation for one frame first.
  const routeKey = `${pathname}?${searchParams.get("thread") ?? ""}`;
  const [seenRoute, setSeenRoute] = useState(routeKey);
  if (routeKey !== seenRoute) {
    setSeenRoute(routeKey);
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Show conversations" />
        }
      >
        Chats
        {conversations.length > 0 && (
          <span className="ml-1 tabular-nums opacity-70">
            ({conversations.length})
          </span>
        )}
      </SheetTrigger>

      <SheetContent side="left" className="w-80 max-w-[85vw]">
        <SheetHeader>
          <SheetTitle>Conversations</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 px-3 pb-4">
          <ConversationList
            conversations={conversations}
            activeThreadId={activeThreadId}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
