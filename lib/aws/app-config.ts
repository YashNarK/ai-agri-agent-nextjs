// ============================================================
// lib/aws/app-config.ts
//
// AWS Secrets Manager and SSM Parameter Store integration.
//
// SECRETS MANAGER:
//   stores sensitive values — DB passwords, API keys
//   encrypted at rest by KMS automatically
//   fetched once (memoised for the process lifetime)
//   the app fails fast if secrets are unavailable
//
// SSM PARAMETER STORE:
//   stores non-sensitive configuration
//   enables per-environment config without code changes
//   falls back to the defaults in lib/config/settings.ts
//
// AppConfig:
//   a clean container for all resolved configuration.
//   FastAPI kept it on `app.state`; Next.js has no lifespan,
//   so it is a module-level memoised promise instead — which
//   gives the same "resolve once, reuse everywhere" behaviour.
//
// Port of core/security/aws_config.py
// ============================================================

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import { settings } from "@/lib/config/settings";

// ============================================================
// Secret shapes — these mirror what is stored in Secrets Manager
// ============================================================

interface DBSecret {
  host: string;
  username: string;
  password: string;
  dbname: string;
  port?: string;
}

interface OpenAISecret {
  embed_api_key: string;
  embed_endpoint: string;
  chat_api_key: string;
  chat_endpoint: string;
}

interface AzureMLSecret {
  endpoint_url: string;
  api_key: string;
  model_name: string;
}

// ============================================================
// Resolved runtime configuration
// ============================================================

export interface DatabaseConfig {
  host: string;
  user: string;
  password: string;
  database: string;
  port: string;
  /** full libpq connection URL consumed by the Prisma/Neon adapter */
  url: string;
}

export interface AzureOpenAIConfig {
  embedApiKey: string;
  embedEndpoint: string;
  embedModelName: string;
  embedApiVersion: string;
  chatApiKey: string;
  chatEndpoint: string;
  chatModelName: string;
  chatApiVersion: string;
}

export interface AzureMLConfig {
  endpointUrl: string;
  apiKey: string;
  modelName: string;
}

export interface AppConfig {
  database: DatabaseConfig;
  azureOpenAI: AzureOpenAIConfig;
  azureML: AzureMLConfig;
  dbSchema: string;
}

// ============================================================
// AWS clients — created lazily, reused for the process lifetime
// ============================================================

let _secretsClient: SecretsManagerClient | undefined;
let _ssmClient: SSMClient | undefined;

const secretsClient = (): SecretsManagerClient =>
  (_secretsClient ??= new SecretsManagerClient({ region: settings.AWS_REGION }));

const ssmClient = (): SSMClient =>
  (_ssmClient ??= new SSMClient({ region: settings.AWS_REGION }));

/**
 * Fetches and parses a JSON secret from Secrets Manager.
 * All secret values are strings.
 */
async function getSecret<T>(secretName: string): Promise<T> {
  const response = await secretsClient().send(
    new GetSecretValueCommand({ SecretId: secretName }),
  );
  if (!response.SecretString) {
    throw new Error(`Secret '${secretName}' has no SecretString payload.`);
  }
  return JSON.parse(response.SecretString) as T;
}

/**
 * Fetches a single parameter from SSM Parameter Store.
 * Falls back to `fallback` when the parameter is missing —
 * in development SSM may not be available at all.
 * WithDecryption handles SecureString parameters.
 */
async function getParameter(name: string, fallback: string): Promise<string> {
  try {
    const response = await ssmClient().send(
      new GetParameterCommand({ Name: name, WithDecryption: true }),
    );
    return response.Parameter?.Value ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Logs which keys are present/missing without exposing values.
 * Throws a clear startup error if any required key is empty.
 */
function logSecretStatus(name: string, secret: Record<string, unknown>): void {
  const missing = Object.keys(secret).filter((k) => !secret[k]);
  const present = Object.keys(secret).filter((k) => Boolean(secret[k]));

  console.log(
    `[secret fetched] ${name}: keys present=${JSON.stringify(present)}, keys missing=${JSON.stringify(missing)}`,
  );

  if (missing.length > 0) {
    throw new Error(
      `Secret '${name}' is incomplete — missing or empty keys: ${missing.join(", ")}. ` +
        "Check AWS Secrets Manager and ensure all required fields are populated.",
    );
  }
}

// ============================================================
// Public loaders
// ============================================================

/**
 * Fetches ONLY the database secret and builds a DatabaseConfig.
 * Used by schema-setup tooling so creating the DB/schema does not
 * require the Azure secrets to exist.
 *
 * DATABASE_URL, when set, short-circuits AWS entirely — matching
 * core/sql_runner.py's resolution order and keeping `prisma
 * migrate`/`prisma db pull` workable locally.
 */
export async function loadDatabaseConfig(): Promise<DatabaseConfig> {
  const envUrl = process.env.DATABASE_URL?.trim();
  if (envUrl) {
    const parsed = new URL(envUrl);
    return {
      host: parsed.hostname,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
      port: parsed.port || "5432",
      url: envUrl,
    };
  }

  const secret = await getSecret<DBSecret>(settings.DB_SECRET_NAME);
  const host = secret.host;
  const user = secret.username;
  const password = secret.password;
  const database = secret.dbname;
  const port = secret.port ?? "5432";

  // Credentials are percent-encoded on the way into the URL — the Python
  // app did the same via scripts/url_parse.url_to_str (quote_plus), so a
  // password containing @ : / # survives the round trip.
  //
  // asyncpg took SSL via connect_args; the Neon driver takes it on the URL.
  const sslmode = settings.DB_SSL ? "require" : "prefer";
  const url =
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${host}:${port}/${database}?sslmode=${sslmode}`;

  return { host, user, password, database, port, url };
}

let _appConfig: Promise<AppConfig> | undefined;

/**
 * Loads all configuration: secrets from Secrets Manager, non-secret
 * config from SSM Parameter Store. Memoised — the first caller pays
 * the AWS round-trips, everyone else reuses the resolved AppConfig.
 *
 * A rejected load is not cached, so a transient AWS failure does not
 * poison the process for its whole lifetime.
 */
export function loadAppConfig(): Promise<AppConfig> {
  _appConfig ??= buildAppConfig().catch((error: unknown) => {
    _appConfig = undefined;
    throw error;
  });
  return _appConfig;
}

async function buildAppConfig(): Promise<AppConfig> {
  // -- fetch and validate secrets from Secrets Manager --
  const database = await loadDatabaseConfig();
  console.log(`[secret fetched] database: url_present=${Boolean(database.url)}`);
  if (!database.url) {
    throw new Error("Database URL is missing — check AWS Secrets Manager.");
  }

  const [openaiSecret, azureMlSecret] = await Promise.all([
    getSecret<OpenAISecret>(settings.AZURE_OPENAI_SECRET_NAME),
    getSecret<AzureMLSecret>(settings.AZURE_ML_SECRET_NAME),
  ]);
  logSecretStatus("azure_openai", openaiSecret as unknown as Record<string, unknown>);
  logSecretStatus("azure_ml", azureMlSecret as unknown as Record<string, unknown>);

  // -- fetch non-secret config from SSM Parameter Store --
  const [
    embedModelName,
    chatModelName,
    embedApiVersion,
    chatApiVersion,
    dbSchema,
  ] = await Promise.all([
    getParameter(settings.SSM_EMBED_MODEL_NAME, settings.DEFAULT_EMBED_MODEL_NAME),
    getParameter(settings.SSM_CHAT_MODEL_NAME, settings.DEFAULT_CHAT_MODEL_NAME),
    getParameter(settings.SSM_EMBED_API_VERSION, settings.DEFAULT_EMBED_API_VERSION),
    getParameter(settings.SSM_CHAT_API_VERSION, settings.DEFAULT_CHAT_API_VERSION),
    getParameter(settings.SSM_DB_SCHEMA, settings.DEFAULT_DB_SCHEMA),
  ]);

  return {
    database,
    azureOpenAI: {
      embedApiKey: openaiSecret.embed_api_key,
      embedEndpoint: openaiSecret.embed_endpoint,
      embedModelName,
      embedApiVersion,
      chatApiKey: openaiSecret.chat_api_key,
      chatEndpoint: openaiSecret.chat_endpoint,
      chatModelName,
      chatApiVersion,
    },
    azureML: {
      endpointUrl: azureMlSecret.endpoint_url,
      apiKey: azureMlSecret.api_key,
      modelName: azureMlSecret.model_name,
    },
    dbSchema,
  };
}
