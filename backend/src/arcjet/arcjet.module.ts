
import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import arcjet, { shield, detectBot, fixedWindow } from '@arcjet/node';

export const ARCJET = 'ARCJET';

export type ArcjetClient = ReturnType<typeof arcjet>;

let rawArcjetClient: ArcjetClient;

export function getRawArcjetClient(): ArcjetClient {
  if (!rawArcjetClient) {
    throw new Error(
      'Arcjet client has not been initialized. Check ArcjetModule registration.',
    );
  }

  return rawArcjetClient;
}

@Injectable()
class ArcjetLifecycle implements OnModuleInit {
  private readonly logger = new Logger(ArcjetLifecycle.name);

  onModuleInit(): void {
    // The provider factory has already initialized the client.
    getRawArcjetClient();

    this.logger.log(
      'Arcjet client initialized successfully. Security rules are configured.',
    );
  }
}

@Global()
@Module({
  providers: [
    {
      provide: ARCJET,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): ArcjetClient => {
        rawArcjetClient = arcjet({
          key: configService.getOrThrow<string>('ARCJET_KEY'),
          rules: [
            shield({ mode: 'LIVE' }),
            detectBot({ mode: 'LIVE', allow: [] }),
            fixedWindow({
              mode: 'LIVE',
              window: '1m',
              max: 60,
            }),
          ],
        });

        return rawArcjetClient;
      },
    },
    ArcjetLifecycle,
  ],
  exports: [ARCJET],
})
export class ArcjetModule { }
