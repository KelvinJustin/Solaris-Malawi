import { FeeType } from '../../src/generated/prisma/enums.js';
import { createFeePolicyVersion } from '../../src/ledger/fee-policy-management.js';
import {
  createFileLogger,
  flushFileLogger,
} from '../../src/logging/file-logger.js';
import { disconnectSeedClient, prisma } from './seed-client.js';

const logger = createFileLogger('fee-policy-seeder');

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredOption(name: string): string {
  const value = option(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const type = requiredOption('type') as FeeType;
  if (!Object.values(FeeType).includes(type)) {
    throw new Error('--type must be ZERO, PERCENTAGE, FIXED, or HYBRID');
  }
  const currency = (option('currency') ?? 'MWK').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('--currency must be a 3-letter code');

  const merchantId = option('merchant-id')?.trim() || null;
  const version = Number(requiredOption('version'));
  const percentageBps = Number(option('percentage-bps') ?? 0);
  const fixedText = option('fixed-tambala') ?? '0';
  if (!Number.isInteger(version) || version < 1) throw new Error('--version must be a positive integer');
  if (!Number.isInteger(percentageBps) || percentageBps < 0 || percentageBps > 9_999) throw new Error('--percentage-bps must be between 0 and 9999 basis points');
  if (!/^\d+$/.test(fixedText)) throw new Error('--fixed-tambala must be a nonnegative integer');
  const fixedAmountTambala = BigInt(fixedText);
  const source = requiredOption('source');
  if (source.length > 255) throw new Error('--source must be at most 255 characters');
  const activate = process.argv.includes('--activate');

  if (type === FeeType.ZERO && (percentageBps !== 0 || fixedAmountTambala !== 0n)) {
    throw new Error('ZERO policies must have zero percentage and fixed amount');
  }
  if (type === FeeType.PERCENTAGE && fixedAmountTambala !== 0n) {
    throw new Error('PERCENTAGE policies cannot include a fixed amount');
  }
  if (type === FeeType.FIXED && percentageBps !== 0) {
    throw new Error('FIXED policies cannot include a percentage');
  }

  const result = await prisma.$transaction((tx) =>
    createFeePolicyVersion(tx, {
      merchantId,
      currency,
      type,
      percentageBps,
      fixedAmountTambala,
      version,
      source,
      activate,
    }),
  );

  logger.info({ ...result, merchantId, currency, type, source }, 'Fee policy version created');
}

try {
  await main();
} catch (error) {
  logger.error({ err: error }, 'Fee policy seeding failed');
  process.exitCode = 1;
} finally {
  await disconnectSeedClient();
  await flushFileLogger(logger);
}
