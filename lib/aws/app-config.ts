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
  /** Pooled (PgBouncer) connection string — preferred for app traffic. */
  database_url?: string;
  /** Direct, non-pooled connection string — required for DDL and migrations. */
  direct_database_url?: string;
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
  /**
   * Pooled connection URL — what the Prisma/Neon adapter uses for all
   * application traffic. Neon's pooler is PgBouncer in transaction mode,
   * which is ideal for many short CRUD connections.
   */
  url: string;
  /**
   * Direct, non-pooled connection URL.
   *
   * DDL belongs here, not on the pooled endpoint: migrations take session
   * advisory locks and run multi-statement scripts, neither of which
   * survives transaction-mode pooling. Falls back to `url` when the secret
   * predates the split, so this is always safe to read.
   */
  directUrl: string;
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

/**
 * Credentials read from our own variable names, or undefined to leave the
 * SDK's default provider chain in place.
 *
 * $AWS_ACCESS_KEY_ID, $AWS_SECRET_ACCESS_KEY and $AWS_SESSION_TOKEN are
 * reserved Lambda runtime variables — the same trap as $AWS_REGION, one
 * layer down (see lib/config/settings.ts). Vercel functions run on Lambda,
 * whose runtime injects its own execution-role trio. The default chain then
 * assembles a *mixture*: our static key and secret from the project config,
 * the platform's session token alongside them. AWS rejects that combination
 * with UnrecognizedClientException — a static key ID does not go with someone
 * else's session token. $APP_AWS_* names are ours alone, and passing them
 * explicitly keeps the runtime's values out of the credential entirely.
 *
 * Returning undefined when unset is deliberate: it restores the default
 * chain, which is how IAM roles on real AWS compute (and `aws configure`
 * locally) are meant to work.
 */
function explicitCredentials() {
  const accessKeyId = process.env.APP_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.APP_AWS_SECRET_ACCESS_KEY?.trim();
  const sessionToken = process.env.APP_AWS_SESSION_TOKEN?.trim();

  if (!accessKeyId || !secretAccessKey) return undefined;
  return { accessKeyId, secretAccessKey, sessionToken };
}

const clientConfig = () => ({
  region: settings.AWS_REGION,
  credentials: explicitCredentials(),
});

const secretsClient = (): SecretsManagerClient =>
  (_secretsClient ??= new SecretsManagerClient(clientConfig()));

const ssmClient = (): SSMClient => (_ssmClient ??= new SSMClient(clientConfig()));

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

/** Splits a connection URL back into its parts for the DatabaseConfig fields. */
function describeUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    port: parsed.port || "5432",
  };
}

/**
 * Fetches ONLY the database secret and builds a DatabaseConfig.
 * Used by schema-setup tooling so creating the DB/schema does not
 * require the Azure secrets to exist.
 *
 * Resolution order, highest priority first:
 *   1. $DATABASE_URL / $DIRECT_URL      (local dev, and the Prisma CLI)
 *   2. secret.database_url / .direct_database_url
 *   3. a URL composed from host/username/password/dbname/port
 *
 * Step 3 keeps older secrets — which carried only the discrete fields —
 * working unchanged. When only one URL is available, both `url` and
 * `directUrl` point at it, so callers never have to null-check.
 */
export async function loadDatabaseConfig(): Promise<DatabaseConfig> {
  const envUrl = process.env.DATABASE_URL?.trim();
  const envDirectUrl = process.env.DIRECT_URL?.trim();

  if (envUrl) {
    return {
      ...describeUrl(envUrl),
      url: envUrl,
      directUrl: envDirectUrl || envUrl,
    };
  }

  const secret = await getSecret<DBSecret>(settings.DB_SECRET_NAME);

  // Credentials are percent-encoded on the way into the URL — the Python
  // app did the same via scripts/url_parse.url_to_str (quote_plus), so a
  // password containing @ : / # survives the round trip.
  //
  // asyncpg took SSL via connect_args; the Neon driver takes it on the URL.
  const sslmode = settings.DB_SSL ? "require" : "prefer";
  const composed =
    `postgresql://${encodeURIComponent(secret.username)}:${encodeURIComponent(secret.password)}` +
    `@${secret.host}:${secret.port ?? "5432"}/${secret.dbname}?sslmode=${sslmode}`;

  // Prefer the ready-made URLs when the secret carries them: they encode
  // the pooled-vs-direct hostname distinction, which cannot be derived
  // from the discrete `host` field alone.
  const url = secret.database_url?.trim() || composed;
  const directUrl = secret.direct_database_url?.trim() || url;

  return { ...describeUrl(url), url, directUrl };
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
