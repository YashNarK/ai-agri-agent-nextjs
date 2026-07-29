import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Neon driver and the Prisma adapter use Node.js-specific features
  // (WebSocket transport, native engine resolution) that misbehave once
  // bundled into the server build. Opting them out makes Next require
  // them natively instead.
  serverExternalPackages: [
    "@prisma/adapter-neon",
    "@neondatabase/serverless",
    "ws",
  ],

  env: {
    // CopilotKit's runtime posts anonymous usage telemetry to its own
    // servers unless told not to, and announces so at build time. This
    // app was never asked to report anything outward, so it is off by
    // default; delete this line to opt back in.
    COPILOTKIT_TELEMETRY_DISABLED: "true",
  },
};

export default nextConfig;
