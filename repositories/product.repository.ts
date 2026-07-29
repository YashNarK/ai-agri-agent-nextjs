// ============================================================
// repositories/product.repository.ts
// Product catalogue access
// ============================================================

import { getPrisma } from "@/lib/prisma";

export interface ProductListFilter {
  cropId?: number | null;
  category?: string | null;
  search?: string | null;
  limit?: number;
}

export class ProductRepository {
  /**
   * Catalog listing with optional filters. `search` matches name, SKU or
   * active ingredient — one box in the UI rather than three.
   */
  async list({ cropId, category, search, limit = 100 }: ProductListFilter) {
    const prisma = await getPrisma();
    return prisma.products.findMany({
      where: {
        ...(cropId ? { crop_id: cropId } : {}),
        ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { sku: { contains: search, mode: "insensitive" } },
                { active_ingredient: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
      take: limit,
      include: { crops: { select: { code: true, name: true } } },
    });
  }

  /** Distinct categories, for the filter dropdown. */
  async listCategories() {
    const prisma = await getPrisma();
    return prisma.products.findMany({
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    });
  }

  async findById(id: number) {
    const prisma = await getPrisma();
    return prisma.products.findUnique({ where: { id } });
  }

  async findBySku(sku: string) {
    const prisma = await getPrisma();
    return prisma.products.findUnique({ where: { sku } });
  }

  async findByCropId(cropId: number) {
    const prisma = await getPrisma();
    return prisma.products.findMany({ where: { crop_id: cropId } });
  }

  async searchByDescription(description: string) {
    const prisma = await getPrisma();
    return prisma.products.findMany({
      where: { description: { contains: description, mode: "insensitive" } },
    });
  }

  async searchByActiveIngredient(activeIngredient: string) {
    const prisma = await getPrisma();
    return prisma.products.findMany({
      where: {
        active_ingredient: { contains: activeIngredient, mode: "insensitive" },
      },
    });
  }

  async searchByName(name: string) {
    const prisma = await getPrisma();
    return prisma.products.findMany({
      where: { name: { contains: name, mode: "insensitive" } },
    });
  }

  async searchByCategory(category: string) {
    const prisma = await getPrisma();
    return prisma.products.findMany({
      where: { category: { contains: category, mode: "insensitive" } },
    });
  }

  async searchBySubCategory(subCategory: string) {
    const prisma = await getPrisma();
    return prisma.products.findMany({
      where: { sub_category: { contains: subCategory, mode: "insensitive" } },
    });
  }
}
