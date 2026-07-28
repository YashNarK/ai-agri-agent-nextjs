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
};

export default nextConfig;
