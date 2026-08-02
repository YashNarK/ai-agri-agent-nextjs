// ============================================================
// lib/config/settings.ts
//
// Application settings loaded from the process environment.
// No secrets here — only configuration and secret *names*.
// Secrets are fetched from AWS Secrets Manager on first use;
// non-secret config from SSM Parameter Store.
//
// Port of core/config.py (pydantic BaseSettings).
// ============================================================

const str = (key: string, fallback: string): string =>
  process.env[key]?.trim() || fallback;

const bool = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
};

const num = (key: string, fallback: number): number => {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) ? raw : fallback;
};

export const settings = {
  // application
  APP_NAME: str("APP_NAME", "Agricultural Intelligence Platform"),
  APP_VERSION: str("APP_VERSION", "1.0.0"),
  DEBUG: bool("DEBUG", false),

  // database — require TLS (Neon / managed Postgres)
  DB_SSL: bool("DB_SSL", true),

  // http client (ms — python used seconds)
  HTTP_CLIENT_TIMEOUT_MS: num("HTTP_CLIENT_TIMEOUT", 30) * 1000,

  // aws — where to find things, not the things themselves
  //
  // Deliberately NOT read from $AWS_REGION. That name is a reserved Lambda
  // runtime variable, and Vercel functions run on Lambda: the runtime sets
  // it to the *function's* region (us-east-1 for iad1), overriding whatever
  // the project config says. Reading it sent GetSecretValue to us-east-1,
  // where the prod/agri/* policy grants nothing — an AccessDeniedException
  // that reproduced only on Vercel. $APP_AWS_REGION is ours alone, so no
  // platform can quietly redirect the SDK away from where the secrets live.
  AWS_REGION: str("APP_AWS_REGION", "ap-south-1"),
  DB_SECRET_NAME: str("DB_SECRET_NAME", "prod/agri/database"),
  AZURE_OPENAI_SECRET_NAME: str("AZURE_OPENAI_SECRET_NAME", "prod/agri/azure-openai"),

  // price model — a Lambda in this same account, invoked with SigV4.
  //
  // Neither value is a secret, so neither is in Secrets Manager: a
  // function name is not sensitive, and there is no API key to hold.
  // Authorisation is IAM on the caller's credentials, which means the
  // model has no publicly reachable endpoint at all. This replaced the
  // Azure ML managed online endpoint, which cost ~₹5,400/month to idle.
  MODEL_FUNCTION_NAME: str("MODEL_FUNCTION_NAME", "agri-price-model"),

  // written to price_predictions.model_version on every forecast
  MODEL_VERSION_LABEL: str("MODEL_VERSION_LABEL", "crop-price-gbr"),

  // ssm parameter paths
  SSM_EMBED_MODEL_NAME: str("SSM_EMBED_MODEL_NAME", "/prod/agri/embed-model-name"),
  SSM_CHAT_MODEL_NAME: str("SSM_CHAT_MODEL_NAME", "/prod/agri/chat-model-name"),
  SSM_EMBED_API_VERSION: str("SSM_EMBED_API_VERSION", "/prod/agri/embed-api-version"),
  SSM_CHAT_API_VERSION: str("SSM_CHAT_API_VERSION", "/prod/agri/chat-api-version"),
  SSM_DB_SCHEMA: str("SSM_DB_SCHEMA", "/prod/agri/db-schema"),

  // local fallback defaults
  DEFAULT_EMBED_MODEL_NAME: str("DEFAULT_EMBED_MODEL_NAME", "embedding"),
  DEFAULT_CHAT_MODEL_NAME: str("DEFAULT_CHAT_MODEL_NAME", "DeepSeek-V3.2"),
  DEFAULT_EMBED_API_VERSION: str("DEFAULT_EMBED_API_VERSION", "2023-05-15"),
  DEFAULT_CHAT_API_VERSION: str("DEFAULT_CHAT_API_VERSION", "2024-05-01-preview"),
  DEFAULT_DB_SCHEMA: str("DEFAULT_DB_SCHEMA", "agricultural"),
} as const;

export type Settings = typeof settings;
