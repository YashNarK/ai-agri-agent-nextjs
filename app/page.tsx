// ============================================================
// app/page.tsx
//
// The root sends people to the dashboard.
//
// It used to render the API index, which meant the first thing any
// visitor saw was a table of endpoints — accurate, but it presented a
// product as if it were a bare service. The endpoint list now lives at
// /docs (see app/docs/page.tsx), where FastAPI puts its equivalent.
//
// A redirect rather than rendering the dashboard here: /dashboard is a
// real route with its own guards and metadata, and duplicating it at
// the root would give the same page two URLs to keep in step.
// ============================================================

import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/dashboard");
}
