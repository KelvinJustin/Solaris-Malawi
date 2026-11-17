
import bcrypt from "bcrypt";

import {
  prisma,
  disconnectSeedClient,
} from "./seed-client.js";
import {
  createFileLogger,
  flushFileLogger,
} from "../../src/logging/file-logger.js";

const logger = createFileLogger("merchant-seeder");

const fixtures = [
  {
    name: "Development Sole Trader",
    email: "seed.soletrader@solaris.local",
    phone: "+265991000101",
  },
  {
    name: "Development Limited Company",
    email: "seed.company@solaris.local",
    phone: "+265991000102",
  },
  {
    name: "Development Pending Merchant",
    email: "seed.pending@solaris.local",
    phone: "+265991000103",
  },
  {
    name: "Development Approved Merchant",
    email: "seed.approved@solaris.local",
    phone: "+265991000104",
  },
];

async function main(): Promise<void> {
  logger.info("[MERCHANT SEED] Seeder loaded.");
  logger.info({ fixtureCount: fixtures.length }, "[MERCHANT SEED] Fixtures loaded");
  logger.info("[MERCHANT SEED] Starting...");

  const passwordHash = await bcrypt.hash(
    "DevSeedPassword123!",
    10,
  );

  for (const fixture of fixtures) {
    const merchant = await prisma.merchant.upsert({
      where: { email: fixture.email },
      update: {
        name: fixture.name,
        phone: fixture.phone,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
      create: {
        ...fixture,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });

    logger.info({ merchantId: merchant.id, email: merchant.email }, "[MERCHANT SEED] Merchant ready");

    await prisma.merchantLedger.upsert({
      where: { merchantId: merchant.id },
      update: {},
      create: {
        merchantId: merchant.id,
        currency: "MWK",
      },
    });

    logger.info({ merchantId: merchant.id }, "[MERCHANT SEED] Ledger ready");
  }

  logger.info("[MERCHANT SEED] SUCCESS — all merchant fixtures seeded.");
}

logger.info("[MERCHANT SEED] Loading seeder...");

try {
  await main();
} catch (error) {
  logger.error({ err: error }, "[MERCHANT SEED] FAILED");
  process.exitCode = 1;
} finally {
  logger.info("[MERCHANT SEED] Disconnecting from database...");
  await disconnectSeedClient();
  logger.info("[MERCHANT SEED] Seeder finished.");
    await flushFileLogger(logger);
}
