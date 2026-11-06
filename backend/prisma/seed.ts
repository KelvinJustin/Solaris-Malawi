
const typeFlagIndex = process.argv.indexOf("--type");

const seedType =
  typeFlagIndex === -1
    ? undefined
    : process.argv[typeFlagIndex + 1];

const seeders = {
  profiles: "./seeders/profiles.seeder.ts",
  merchants: "./seeders/merchants.seeder.ts",
  admin: "./seeders/admin.seeder.ts",
} as const;

if (!seedType || !(seedType in seeders)) {
  console.error(
    "Specify a valid seeder: profiles, merchants, or admin.",
  );
  process.exit(1);
}

try {
  await import(
    seeders[seedType as keyof typeof seeders]
  );
} catch (error) {
  console.error(`Failed to run the ${seedType} seeder:`, error);
  process.exitCode = 1;
}
