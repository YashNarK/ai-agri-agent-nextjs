// ============================================================
// app/api/auth/[...nextauth]/route.ts
//
// The Auth.js endpoint: sign-in, callback, sign-out, CSRF and session
// all live under /api/auth/*. The catch-all is required — Auth.js owns
// several paths beneath this prefix, not one.
// ============================================================

import { handlers } from "@/auth";

// bcrypt and the Prisma client are both Node-only, and the jwt callback
// touches the database.
export const runtime = "nodejs";

export const { GET, POST } = handlers;
