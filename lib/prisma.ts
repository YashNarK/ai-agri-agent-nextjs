import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaClientOptions } from "@/app/generated/prisma/internal/prismaNamespace";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma: PrismaClient;
};

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL,
});

const prismaClientOptions: PrismaClientOptions = {
  adapter,
  log: ["query", "warn", "error"],
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient(prismaClientOptions);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
