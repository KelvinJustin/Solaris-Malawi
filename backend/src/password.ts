const MIN_BCRYPT_COST = 4;
const MAX_BCRYPT_COST = 15;
const DEFAULT_BCRYPT_COST = 12;

function isTestLikeEnvironment(): boolean {
  return (
    !process.env.NODE_ENV ||
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST !== undefined
  );
}

export function resolvePasswordHashCost(): number {
  if (isTestLikeEnvironment()) {
    return MIN_BCRYPT_COST;
  }

  const configuredCost = Number(process.env.ENCRYPTION_SALT);

  if (!Number.isInteger(configuredCost)) {
    return DEFAULT_BCRYPT_COST;
  }

  if (configuredCost < MIN_BCRYPT_COST || configuredCost > MAX_BCRYPT_COST) {
    return DEFAULT_BCRYPT_COST;
  }

  return configuredCost;
}
