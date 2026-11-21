import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Body,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { verifyNowPaymentsIpnSignature } from './nowpayments-ipn.util.js';
import { NowPaymentsWebhookService, isNowPaymentsIpnPayload } from './nowpayments-webhook.service.js';

@Controller('webhooks/nowpayments')
export class NowPaymentsWebhookController {
  private readonly logger = new Logger(NowPaymentsWebhookController.name);

  constructor(
    private readonly webhookService: NowPaymentsWebhookService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Body() body: unknown,
    @Headers('x-nowpayments-sig') signature: string | undefined,
  ) {
    const ipnSecret = this.configService.get<string>('nowpayments.ipnSecret');

    if (!ipnSecret || !verifyNowPaymentsIpnSignature(body, signature, ipnSecret)) {
      this.logger.warn('Rejected NOWPayments IPN with invalid or missing signature.');
      throw new ForbiddenException('Invalid signature.');
    }

    if (!isNowPaymentsIpnPayload(body)) {
      this.logger.warn(`Rejected NOWPayments IPN with an unrecognized payload shape: ${JSON.stringify(body)}`);
      throw new BadRequestException('Unrecognized payload shape.');
    }

    await this.webhookService.handleVerifiedCallback(body);

    return { received: true };
  }
}