import { resolve } from 'node:path';

export function createPinoTargets(logDirectory: string, level: string) {
  return [
    {
      target: 'pino-roll',
      level,
      options: {
        file: resolve(logDirectory, 'solaris'),
        extension: 'log',
        frequency: 'daily',
        size: '20m',
        limit: { count: 14 },
        mkdir: true,
      },
    },
    {
      target: 'pino/file',
      level,
      options: { destination: 1 },
    },
  ];
}
