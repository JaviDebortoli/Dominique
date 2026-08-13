import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires an explicit driver adapter at runtime (the CLI reads
// the URL from prisma.config.ts, but PrismaClient itself no longer accepts
// a bare connection string). See .agents/skills/prisma-postgres-setup.
function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  return new PrismaClient({ adapter });
}

declare global {
  var __prisma: ReturnType<typeof createPrismaClient> | undefined;
}

// Singleton across Next.js dev-mode HMR reloads — avoids exhausting the
// Postgres connection pool by creating a new PrismaClient per reload.
export const prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
