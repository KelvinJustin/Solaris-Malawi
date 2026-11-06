
import bcrypt from "bcrypt";

import {
  prisma,
  disconnectSeedClient,
} from "./seed-client.js";

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
  console.log("[MERCHANT SEED] Seeder loaded.");
  console.log(`[MERCHANT SEED] ${fixtures.length} merchant fixtures found.`);
  console.log("[MERCHANT SEED] Starting...");

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

    console.log(`[MERCHANT SEED] Merchant ready: ${merchant.email}`);

    await prisma.merchantLedger.upsert({
      where: { merchantId: merchant.id },
      update: {},
      create: {
        merchantId: merchant.id,
        currency: "MWK",
      },
    });

    console.log(`[MERCHANT SEED] Ledger ready: ${merchant.email}`);
  }

  console.log("[MERCHANT SEED] SUCCESS — all merchant fixtures seeded.");
}

console.log("[MERCHANT SEED] Loading seeder...");

try {
  await main();
} catch (error) {
  console.error("[MERCHANT SEED] FAILED:", error);
  process.exitCode = 1;
} finally {
  console.log("[MERCHANT SEED] Disconnecting from database...");
  await disconnectSeedClient();
  console.log("[MERCHANT SEED] Seeder finished.");
}
