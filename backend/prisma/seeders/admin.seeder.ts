
import bcrypt from "bcrypt";

import {
  AdminRole,
  AdminStatus,
} from "../../src/generated/prisma/enums.js";

import {
  prisma,
  disconnectSeedClient,
} from "./seed-client.js";

const fixture = {
  name: "Development Compliance Admin",
  email: "seed.admin@solaris.local",
  password: "DevAdminPassword123!",
  role: AdminRole.COMPLIANCE,
};

async function main(): Promise<void> {
  console.log("[ADMIN SEED] Seeder loaded.");
  console.log(`[ADMIN SEED] Preparing admin: ${fixture.email}`);
  console.log("[ADMIN SEED] Hashing development password...");

  const passwordHash = await bcrypt.hash(fixture.password, 10);

  console.log("[ADMIN SEED] Creating or updating admin...");

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

  console.log(`[ADMIN SEED] Admin ready: ${admin.email}`);
  console.log(`[ADMIN SEED] Role: ${admin.role}`);
  console.log("[ADMIN SEED] SUCCESS — admin fixture seeded.");
}

console.log("[ADMIN SEED] Loading seeder...");

try {
  await main();
} catch (error) {
  console.error("[ADMIN SEED] FAILED:", error);
  process.exitCode = 1;
} finally {
  console.log("[ADMIN SEED] Disconnecting from database...");
  await disconnectSeedClient();
  console.log("[ADMIN SEED] Seeder finished.");
}
