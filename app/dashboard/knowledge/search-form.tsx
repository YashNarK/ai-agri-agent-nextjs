"use client";

// ============================================================
// app/dashboard/knowledge/search-form.tsx
//
// Search input, crop filter and retriever selector. Submits by
// navigating, so the query lands in the URL and the results stay a
// Server Component — no client fetching, no loading state to
// hand-manage beyond the transition.
//
// The retriever selector is exposed rather than kept internal because
// hybrid retrieval is otherwise unfalsifiable from the outside: running
// the same query three ways is how anyone — reviewer, or us — checks
// that fusion is actually earning its place instead of reproducing what
// one branch already returned.
// ============================================================

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SearchMode } from "@/lib/schemas";

const ALL_CROPS = "__all__";

const MODES: { value: SearchMode; label: string }[] = [
  { value: "hybrid", label: "Meaning + wording" },
  { value: "semantic", label: "Meaning only" },
  { value: "keyword", label: "Wording only" },
];

export function SearchForm({
  crops,
  query,
  cropCode,
  mode,
}: {
  crops: { code: string; name: string }[];
  query: string;
  cropCode: string;
  mode: SearchMode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(query);
  const [crop, setCrop] = useState(cropCode || ALL_CROPS);
  const [retriever, setRetriever] = useState<SearchMode>(mode);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    const params = new URLSearchParams({ q: trimmed });
    if (crop !== ALL_CROPS) params.set("crop", crop);
    // Omitted at the default, so the ordinary URL stays clean and a
    // shared link does not pin a choice the sharer never made.
    if (retriever !== "hybrid") params.set("mode", retriever);

    startTransition(() => router.push(`/dashboard/knowledge?${params}`));
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask about pests, soil, irrigation…"
        aria-label="Search the knowledge base"
        // min-w on a 390px screen forced the row wider than the viewport;
        // basis-full lets it take its own line on a phone instead.
        className="w-full flex-1 sm:min-w-[240px]"
      />

      <Select value={crop} onValueChange={(v) => v && setCrop(v)}>
        <SelectTrigger
          className="w-full sm:w-[180px]"
          aria-label="Filter by crop"
        >
          {/*
            Rendered explicitly rather than letting SelectValue print the
            raw value. Base UI does not resolve a value back to its item's
            label on its own, so the trigger read "__all__" — the sentinel
            was leaking straight into the UI.
          */}
          <SelectValue>
            {(value) =>
              value === ALL_CROPS
                ? "All crops"
                : (crops.find((c) => c.code === value)?.name ?? String(value))
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_CROPS}>All crops</SelectItem>
          {crops.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={retriever}
        onValueChange={(v) => v && setRetriever(v as SearchMode)}
      >
        <SelectTrigger className="w-full sm:w-[190px]" aria-label="Retriever">
          <SelectValue>
            {(value) =>
              MODES.find((m) => m.value === value)?.label ?? String(value)
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MODES.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button type="submit" disabled={isPending || !value.trim()}>
        {isPending ? "Searching…" : "Search"}
      </Button>
    </form>
  );
}
