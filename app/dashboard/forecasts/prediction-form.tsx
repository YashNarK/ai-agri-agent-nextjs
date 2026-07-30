"use client";

// ============================================================
// app/dashboard/forecasts/prediction-form.tsx
//
// Ask the model for a price.
//
// Native <select> and <input type="date"> rather than the styled
// Calendar popover. The date input is a real date picker in every
// browser, it enforces the future-only bound through `min` without any
// JavaScript, and it is keyboard- and screen-reader-accessible by
// default. The styled version can replace it later; starting there
// would have meant reimplementing all of that first.
//
// `min` is a hint the browser enforces for a user, not a constraint on
// the request — the action re-checks the date server-side.
// ============================================================

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { CropSchema, RegionSchema } from "@/lib/schemas";

import { runPrediction, type PredictionFormState } from "./actions";

const FIELD =
  "h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function PredictionForm({
  crops,
  regions,
  minDate,
  defaultDate,
}: {
  crops: CropSchema[];
  regions: RegionSchema[];
  /** Earliest selectable target — computed on the server so the bound
      does not shift with the viewer's clock or timezone. */
  minDate: string;
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState<PredictionFormState, FormData>(
    runPrediction,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="crop_code">Crop</Label>
          <select id="crop_code" name="crop_code" required className={FIELD}>
            {crops.map((crop) => (
              <option key={crop.code} value={crop.code}>
                {crop.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="region_code">Region</Label>
          <select id="region_code" name="region_code" required className={FIELD}>
            {regions.map((region) => (
              <option key={region.code} value={region.code}>
                {region.name} — {region.country}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="target_date">Target date</Label>
          <input
            id="target_date"
            name="target_date"
            type="date"
            required
            min={minDate}
            defaultValue={defaultDate}
            className={FIELD}
          />
        </div>

        <div className="flex items-end">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Scoring…" : "Run forecast"}
          </Button>
        </div>
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Each run calls the deployed model and is logged below with the exact
        feature row it was scored on.
      </p>
    </form>
  );
}
