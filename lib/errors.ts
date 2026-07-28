// ============================================================
// lib/errors.ts
//
// HTTP error type + a single response mapper for route handlers.
//
// FastAPI raised HTTPException from the service layer and let the
// framework turn it into a JSON body. Route handlers have no such
// hook, so services throw ApiError and every handler funnels its
// catch block through `toErrorResponse`, producing the identical
// `{"detail": "..."}` shape the Python API returns.
// ============================================================

import { NextResponse } from "next/server";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
  }

  get detail(): string {
    return this.message;
  }
}

export const notFound = (detail: string) => new ApiError(404, detail);
export const unprocessable = (detail: string) => new ApiError(422, detail);
export const badGateway = (detail: string) => new ApiError(502, detail);

/**
 * Maps any thrown value to a JSON error response.
 * ApiError keeps its status; anything else is an unhandled 500.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ detail: error.detail }, { status: error.status });
  }

  console.error("[unhandled error]", error);
  const detail = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ detail }, { status: 500 });
}
