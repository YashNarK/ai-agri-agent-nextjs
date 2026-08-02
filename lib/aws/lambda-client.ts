// ============================================================
// lib/aws/lambda-client.ts
//
// Memoised LambdaClient for invoking the price model.
//
// Credentials follow the same rule as lib/aws/app-config.ts: read our
// own $APP_AWS_* names, or return undefined to leave the SDK's default
// provider chain in place. $AWS_ACCESS_KEY_ID and friends are reserved
// Lambda runtime variables, and Vercel functions run on Lambda — the
// platform injects its own execution-role trio, and mixing a static key
// with someone else's session token is rejected as an invalid security
// token. See the long note in app-config.ts.
//
// One client for the process lifetime: it holds a keep-alive connection
// pool, and building a fresh one per request would re-resolve
// credentials and re-open TLS on every forecast.
// ============================================================

import { LambdaClient } from "@aws-sdk/client-lambda";

import { settings } from "@/lib/config/settings";

let _client: LambdaClient | undefined;

function explicitCredentials() {
  const accessKeyId = process.env.APP_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.APP_AWS_SECRET_ACCESS_KEY?.trim();
  const sessionToken = process.env.APP_AWS_SESSION_TOKEN?.trim();

  if (!accessKeyId || !secretAccessKey) return undefined;
  return { accessKeyId, secretAccessKey, sessionToken };
}

export function lambdaClient(): LambdaClient {
  return (_client ??= new LambdaClient({
    region: settings.AWS_REGION,
    credentials: explicitCredentials(),
    // The model's cold start is ~9.5s (unpacking a 536 MB container
    // image), so the default 1s connection / 0s socket timeouts would
    // abort a cold invoke. Kept in step with HTTP_CLIENT_TIMEOUT_MS.
    requestHandler: {
      requestTimeout: settings.HTTP_CLIENT_TIMEOUT_MS,
      connectionTimeout: 5_000,
    },
  }));
}
