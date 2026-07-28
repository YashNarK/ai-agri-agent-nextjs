// ============================================================
// repositories/region.repository.ts
// Region reference-data access
// ============================================================

import { getPrisma } from "@/lib/prisma";

export class RegionRepository {
  /** Every region ordered by name — mirrors `select(RegionORM).order_by(name)`. */
  async findAll() {
    const prisma = await getPrisma();
    return prisma.regions.findMany({ orderBy: { name: "asc" } });
  }

  async findById(id: number) {
    const prisma = await getPrisma();
    return prisma.regions.findUnique({ where: { id } });
  }

  async findByCode(code: string) {
    const prisma = await getPrisma();
    return prisma.regions.findUnique({ where: { code } });
  }

  async searchByName(name: string) {
    const prisma = await getPrisma();
    return prisma.regions.findMany({
      where: { name: { contains: name, mode: "insensitive" } },
    });
  }

  /** Compact (code, name, country) listing for the agent/MCP discovery tools. */
  async listCodes() {
    const prisma = await getPrisma();
    return prisma.regions.findMany({
      select: { code: true, name: true, country: true },
      orderBy: { code: "asc" },
    });
  }
}
