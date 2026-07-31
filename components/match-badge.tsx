// ============================================================
// components/match-badge.tsx
//
// Why one search result is on the page: found by meaning, by wording,
// or by both.
//
// This is provenance, not a score, so it is a label rather than a
// meter. "Both retrievers agreed" is the strongest signal hybrid search
// produces and it has no numeric expression — a document ranked 3rd and
// 4th by the two branches beats one ranked 1st by a single branch, and
// a reader shown only the cosine number would conclude the opposite.
//
// No "use client": pure presentation, so it renders on the server for
// the knowledge page and is equally importable from the client-side
// chat transcript.
// ============================================================

import { Badge } from "@/components/ui/badge";

export type MatchedBy = "both" | "semantic" | "keyword";

const LABELS: Record<MatchedBy, { text: string; title: string }> = {
  both: {
    text: "meaning + wording",
    title:
      "Retrieved by both vector similarity and full-text search — the two agreed.",
  },
  semantic: {
    text: "meaning",
    title:
      "Retrieved by vector similarity. The article does not contain the query's terms verbatim.",
  },
  keyword: {
    text: "wording",
    title:
      "Retrieved by full-text search on the query's exact terms. Vector similarity ranked it outside the pool.",
  },
};

export function MatchBadge({ matchedBy }: { matchedBy: MatchedBy }) {
  const { text, title } = LABELS[matchedBy];
  return (
    <Badge
      // Agreement between two independent retrievers is the one case
      // worth drawing the eye to; the single-retriever cases are
      // context, not a finding.
      variant={matchedBy === "both" ? "default" : "outline"}
      className="shrink-0 font-normal"
      title={title}
    >
      {text}
    </Badge>
  );
}
