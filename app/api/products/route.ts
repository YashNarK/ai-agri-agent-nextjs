// ============================================================
// app/api/products/route.ts
//
// GET /api/products
// Product catalog listing, ordered by name.
//
// Optional filters: crop_code, category, search (matches name, SKU or
// active ingredient), limit (1–500).
//
// The response carries `categories` alongside `products` so the filter
// dropdown populates from the same request.
// ============================================================

import { NextResponse } from "next/server";

import { productsService } from "@/lib/container";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { productQuerySchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const parsed = productQuerySchema.safeParse({
      crop_code: searchParams.get("crop_code") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0].message);
    }

    const { crop_code, category, search, limit } = parsed.data;

    return NextResponse.json(
      await productsService.listProducts({
        cropCode: crop_code,
        category,
        search,
        limit,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
