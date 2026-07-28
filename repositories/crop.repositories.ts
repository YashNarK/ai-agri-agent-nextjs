import { prisma } from "@/lib/prisma";

export class CropsRepository {
  async findAll(limit: number = 10) {
    return prisma.crops.findMany({
      take: limit,
      orderBy: {
        id: "asc",
      },
    });
  }

  async findById(id: number) {
    return prisma.crops.findFirst({
      where: {
        id,
      },
    });
  }

  async findByCode(code: string) {
    return prisma.crops.findFirst({
      where: {
        code,
      },
    });
  }
}
