// ============================================================
// services/price-features.ts
//
// Single source of truth for the crop-price model's feature
// contract. The deployed MLflow model was trained against this
// exact column order — the serving path must not drift from it.
//
// Port of services/price_features.py
// ============================================================

/** categorical features (one-hot encoded inside the model pipeline) */
export const CATEGORICAL_FEATURES = ["crop_code", "region_code"] as const;

/**
 * macro indicators pulled from the market_indicators table.
 * these MUST match the indicator_name values in the DB exactly.
 */
export const MACRO_INDICATORS = [
  "Crude Oil Price",
  "Fertilizer Price Index",
  "Global Food Price Index",
  "USD Index",
] as const;

/** numeric features (order matters for the tabular payload) */
export const NUMERIC_FEATURES = [
  "year",
  "month",
  "month_sin",
  "month_cos",
  "lag_1",
  "lag_2",
  "lag_3",
  "roll_mean_3",
  "last_volume",
  ...MACRO_INDICATORS,
] as const;

/** full ordered feature vector expected by the model signature */
export const FEATURE_COLUMNS: string[] = [
  ...CATEGORICAL_FEATURES,
  ...NUMERIC_FEATURES,
];

/** model output columns (returned by the pyfunc / endpoint) */
export const OUTPUT_COLUMNS = [
  "predicted_price",
  "confidence_low",
  "confidence_high",
] as const;
