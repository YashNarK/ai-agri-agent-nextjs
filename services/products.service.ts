// ============================================================
// services/products.service.ts
// Product catalog browsing
// ============================================================

import type { ProductListResponse, ProductSchema } from "@/lib/schemas";
import type { ProductRepository } from "@/repositories/product.repository";
import type { CropsService } from "@/services/crops.service";

type ProductRow = Awaited<ReturnType<ProductRepository["list"]>>[number];

export function toProductSchema(row: ProductRow): ProductSchema {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    sub_category: row.sub_category,
    crop_id: row.crop_id,
    crop_code: row.crops?.code ?? null,
    description: row.description,
    active_ingredient: row.active_ingredient,
    unit_of_measure: row.unit_of_measure,
  };
}

export interface ProductQuery {
  cropCode?: string | null;
  category?: string | null;
  search?: string | null;
  limit?: number;
}

export class ProductsService {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly cropsService: CropsService,
  ) {}

  /**
   * Filtered catalog listing. Categories ship alongside the results so the
   * filter dropdown can populate from the same request.
   */
  async listProducts({
    cropCode,
    category,
    search,
    limit,
  }: ProductQuery): Promise<ProductListResponse> {
    const crop = cropCode
      ? await this.cropsService.requireCropByCode(cropCode)
      : null;

    const [rows, categoryRows] = await Promise.all([
      this.productRepo.list({
        cropId: crop?.id ?? null,
        category,
        search,
        limit,
      }),
      this.productRepo.listCategories(),
    ]);

    return {
      products: rows.map(toProductSchema),
      categories: categoryRows.map((c) => c.category),
      total: rows.length,
    };
  }
}
