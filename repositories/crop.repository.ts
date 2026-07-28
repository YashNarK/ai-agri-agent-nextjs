// ============================================================
// repositories/crop.repository.ts
// Crop reference-data access
// ============================================================

import { getPrisma } from "@/lib/prisma";

export class CropRepository {
  /** Every crop ordered by name — mirrors `select(CropORM).order_by(name)`. */
  async findAll() {
    const prisma = await getPrisma();
    return prisma.crops.findMany({ orderBy: { name: "asc" } });
  }

  async findById(id: number) {
    const prisma = await getPrisma();
    return prisma.crops.findUnique({ where: { id } });
  }

  /** Codes are case-sensitive across the API, matching `CropORM.code == code`. */
  async findByCode(code: string) {
    const prisma = await getPrisma();
    return prisma.crops.findUnique({ where: { code } });
  }

  async findByName(name: string) {
    const prisma = await getPrisma();
    return prisma.crops.findFirst({
      where: { name: { contains: name, mode: "insensitive" } },
    });
  }

  /** Compact (code, name, category) listing for the agent/MCP discovery tools. */
  async listCodes() {
    const prisma = await getPrisma();
    return prisma.crops.findMany({
      select: { code: true, name: true, category: true },
      orderBy: { code: "asc" },
    });
  }
}
