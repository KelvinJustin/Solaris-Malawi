import {
  createFileLogger,
  flushFileLogger,
} from "../src/logging/file-logger.js";

const typeFlagIndex = process.argv.indexOf("--type");
const seedType =
  typeFlagIndex === -1 ? undefined : process.argv[typeFlagIndex + 1];

const seeders = {
  profiles: "./seeders/profiles.seeder.ts",
  merchants: "./seeders/merchants.seeder.ts",
  admin: "./seeders/admin.seeder.ts",
  fees: "./seeders/fee-policies.seeder.ts",
} as const;

if (!seedType || !(seedType in seeders)) {
  const logger = createFileLogger("prisma-seed");
  logger.error("Specify a valid seeder: profiles, merchants, admin, or fees.");
  process.exitCode = 1;
  await flushFileLogger(logger);
} else {
  try {
    await import(seeders[seedType as keyof typeof seeders]);
  } catch (error) {
    const logger = createFileLogger("prisma-seed");
    logger.error({ err: error, seedType }, "Failed to run seeder");
    process.exitCode = 1;
    await flushFileLogger(logger);
  }
}
