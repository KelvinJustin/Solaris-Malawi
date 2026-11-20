import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { createRequestId } from './logging/request-id.js';
import { createPinoTargets } from './logging/pino-targets.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { MerchantsModule } from './merchants/merchants.module.js';
import { AuthModule } from './auth/auth.module.js';
import { EmailModule } from './email/email.module.js';
import { ArcjetModule } from './arcjet/arcjet.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AdminAuthModule } from './admin-auth/admin-auth.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';
import { PaymentProvidersModule } from './payment-providers/payment-providers.module.js';
import { ProviderCallbacksModule } from './provider-callbacks/provider-callbacks.module.js';
import { StorageModule } from './storage/storage.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { SettlementsModule } from './settlements/settlements.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const level = configService.get<string>('LOG_LEVEL') ?? 'info';
        const logDirectory = configService.get<string>('LOG_DIR') ?? 'logs';

        return {
          pinoHttp: {
            level,
            genReqId: (request) => createRequestId(request),
            serializers: {
              req: (request) => {
                const expressRequest = request as unknown as {
                  baseUrl?: string;
                  id?: string;
                  method?: string;
                  route?: { path?: string | string[] };
                  socket?: { remoteAddress?: string };
                };
                const routePath = expressRequest.route?.path;

                return {
                  id: expressRequest.id,
                  method: expressRequest.method,
                  route:
                    typeof routePath === 'string'
                      ? `${expressRequest.baseUrl ?? ''}${routePath}`
                      : '<unmatched-route>',
                  remoteAddress: expressRequest.socket?.remoteAddress,
                };
              },
              res: (response) => ({ statusCode: response.statusCode }),
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers.x-api-key',
                'req.headers.x-provider-signature',
                'req.headers.x-request-id',
                'res.headers.set-cookie',
              ],
              censor: '[REDACTED]',
            },
            customLogLevel: (_request, response, error) => {
              if (error || response.statusCode >= 500) return 'error';
              if (response.statusCode >= 400) return 'warn';
              return 'info';
            },
            transport: {
              targets: createPinoTargets(logDirectory, level),
            },
          },
        };
      },
    }),
    ArcjetModule,
    DatabaseModule,
    EmailModule,
    AuthModule,
    AdminAuthModule,
    MerchantsModule,
    AdminModule,
    TransactionsModule,
    PaymentProvidersModule,
    ProviderCallbacksModule,
    StorageModule,
    AnalyticsModule,
    SettlementsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
