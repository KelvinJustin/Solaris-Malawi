
import bcrypt from "bcrypt";

import {
  AdminRole,
  AdminStatus,
} from "../../src/generated/prisma/enums.js";

import {
  prisma,
  disconnectSeedClient,
} from "./seed-client.js";
import {
  createFileLogger,
  flushFileLogger,
} from "../../src/logging/file-logger.js";

const logger = createFileLogger("admin-seeder");

const fixture = {
  name: "Development Compliance Admin",
  email: "seed.admin@solaris.local",
  password: "DevAdminPassword123!",
  role: AdminRole.COMPLIANCE,
};

async function main(): Promise<void> {
  logger.info("[ADMIN SEED] Seeder loaded.");
  logger.info({ email: fixture.email }, "[ADMIN SEED] Preparing admin");
  logger.info("[ADMIN SEED] Hashing development password...");

  const passwordHash = await bcrypt.hash(fixture.password, 10);

  logger.info("[ADMIN SEED] Creating or updating admin...");

  const admin = await prisma.admin.upsert({
    where: { email: fixture.email },
    update: {
      name: fixture.name,
      passwordHash,
      role: fixture.role,
      status: AdminStatus.ACTIVE,
      deletedAt: null,
    },
    create: {
      name: fixture.name,
      email: fixture.email,
      passwordHash,
      role: fixture.role,
      status: AdminStatus.ACTIVE,
    },
  });

  logger.info({ adminId: admin.id, email: admin.email }, "[ADMIN SEED] Admin ready");
  logger.info({ role: admin.role }, "[ADMIN SEED] Role assigned");
  logger.info("[ADMIN SEED] SUCCESS — admin fixture seeded.");
}

logger.info("[ADMIN SEED] Loading seeder...");

try {
  await main();
} catch (error) {
  logger.error({ err: error }, "[ADMIN SEED] FAILED");
  process.exitCode = 1;
} finally {
  logger.info("[ADMIN SEED] Disconnecting from database...");
  await disconnectSeedClient();
  logger.info("[ADMIN SEED] Seeder finished.");
    await flushFileLogger(logger);
}
