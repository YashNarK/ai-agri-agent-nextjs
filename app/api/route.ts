// ============================================================
// app/api/route.ts
// GET /api — service index
//
// Port of main.py's `home()` handler.
// ============================================================

import { NextResponse } from "next/server";

import { settings } from "@/lib/config/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    app: settings.APP_NAME,
    version: settings.APP_VERSION,
    mcp: "/api/mcp/mcp",
    mcp_docs: "/docs-mcp",
    endpoints: {
      crops: "/api/crops",
      prices: "/api/prices/{crop_code}/{region_code}",
      regions: "/api/regions",
      predictions: "/api/predictions",
      search: "/api/search",
      chat: "/api/chat",
      chatstream: "/api/chatstream",
    },
  });
}
