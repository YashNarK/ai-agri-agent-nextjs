// ============================================================
// app/dashboard/loading.tsx
//
// Instant feedback for every dashboard navigation.
//
// Next wraps the segment in a Suspense boundary using this file, so the
// moment a link is tapped the old page is replaced by this skeleton
// rather than sitting there until the server responds. That matters
// most on the guarded routes: they resolve a session and may redirect
// to /login before rendering anything, which is long enough on a phone
// for a tap to feel ignored.
//
// It is deliberately generic — a header block and a few cards — because
// it stands in for nine different pages. Matching any one of them
// exactly would make the other eight flicker as the real layout
// replaced a differently-shaped guess.
// ============================================================

import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-[88rem] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>

      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
