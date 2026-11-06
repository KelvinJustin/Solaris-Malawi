import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import arcjet, { shield, detectBot, fixedWindow } from '@arcjet/node';

export const ARCJET = 'ARCJET';
export type ArcjetClient = ReturnType<typeof arcjet>;

// rawArcjetClient is now created inside the factory below,
// not at module load time — so the key is available.
let rawArcjetClient: ArcjetClient;

export function getRawArcjetClient(): ArcjetClient {
  return rawArcjetClient;
}

@Global()
@Module({
  providers: [
    {
      provide: ARCJET,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        rawArcjetClient = arcjet({
          key: configService.getOrThrow<string>('ARCJET_KEY'),
          rules: [
            shield({ mode: 'LIVE' }),
            detectBot({ mode: 'LIVE', allow: [] }),
            fixedWindow({ mode: 'LIVE', window: '1m', max: 60 }),
          ],
        });
        return rawArcjetClient;
      },
    },
  ],
  exports: [ARCJET],
})
export class ArcjetModule {}