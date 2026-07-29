// ============================================================
// components/charts/stats.ts
//
// Statistics helpers, deliberately in a module with NO "use client".
//
// These run on the server — the correlation is computed while the page
// renders, so the browser receives coefficients rather than two full
// series plus the code to reduce them. Exporting them from the chart
// component instead would mark them client-only, and calling one from a
// Server Component then fails at runtime with "attempted to call X from
// the server but X is on the client".
// ============================================================

/**
 * Pearson correlation coefficient.
 *
 * Returns null rather than a number when the input cannot support one:
 * fewer than three paired points, or a series with zero variance. A
 * coefficient over two points is always ±1, and one over a constant
 * series is a division by zero — both would render as a confident
 * finding built on nothing.
 */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;

  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  const den = Math.sqrt(denA * denB);
  return den === 0 ? null : num / den;
}
