import pino, { type Logger as PinoLogger } from 'pino';
import { resolve } from 'node:path';
import { createPinoTargets } from './pino-targets.js';

export function createFileLogger(context: string): PinoLogger {
  const level = process.env.LOG_LEVEL ?? 'info';

  return pino({
    name: context,
    level,
    transport: {
      targets: createPinoTargets(
        resolve(process.env.LOG_DIR ?? 'logs'),
        level,
      ),
    },
  });
}

export function flushFileLogger(logger: PinoLogger): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.flush((error) => (error ? reject(error) : resolve()));
  });
}
