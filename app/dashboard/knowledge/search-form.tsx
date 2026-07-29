"use client";

// ============================================================
// app/dashboard/knowledge/search-form.tsx
//
// Search input and crop filter. Submits by navigating, so the query
// lands in the URL and the results stay a Server Component — no client
// fetching, no loading state to hand-manage beyond the transition.
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

const ALL_CROPS = "__all__";

export function SearchForm({
  crops,
  query,
  cropCode,
}: {
  crops: { code: string; name: string }[];
  query: string;
  cropCode: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(query);
  const [crop, setCrop] = useState(cropCode || ALL_CROPS);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    const params = new URLSearchParams({ q: trimmed });
    if (crop !== ALL_CROPS) params.set("crop", crop);

    startTransition(() => router.push(`/dashboard/knowledge?${params}`));
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask about pests, soil, irrigation…"
        aria-label="Search the knowledge base"
        className="min-w-[240px] flex-1"
      />

      <Select value={crop} onValueChange={(v) => v && setCrop(v)}>
        <SelectTrigger className="w-[180px]" aria-label="Filter by crop">
          <SelectValue />
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

      <Button type="submit" disabled={isPending || !value.trim()}>
        {isPending ? "Searching…" : "Search"}
      </Button>
    </form>
  );
}
