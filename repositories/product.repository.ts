// ============================================================
// repositories/product.repository.ts
// Product catalogue access
// ============================================================

import { getPrisma } from "@/lib/prisma";

export class ProductRepository {
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
