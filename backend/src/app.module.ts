import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
