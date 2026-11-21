import {
    BadRequestException,
    Body,
    Controller,
    Headers,
    HttpCode,
    HttpStatus,
    Post,
    Req,
    UnauthorizedException,
} from '@nestjs/common';

import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { ProviderCallbackDto } from './dto/provider-callback.dto.js';
import { ProviderCallbacksService } from './provider-callbacks.service.js';

import { isNowPaymentsIpnPayload } from '../payment-providers/adapters/nowpayments/nowpayments-webhook-payload.guard.js';
import { verifyNowPaymentsIpnSignature } from '../payment-providers/adapters/nowpayments/nowpayments-ipn.util.js';
import { parseLosslessNowPaymentsJson } from '../payment-providers/adapters/nowpayments/nowpayments-json.util.js';

@Controller('provider-callbacks')
export class ProviderCallbacksController {
    constructor(
        private readonly providerCallbacksService: ProviderCallbacksService,
    ) { }

    /**
     * Receives signed payment-status notifications from the provider.
     *
     * The raw request body is required because the HMAC signature must be
     * validated against the exact bytes sent by the provider, not the parsed JSON
     * object created by NestJS after deserialization.
     */
    @Post()
    @HttpCode(HttpStatus.OK)
    async handleCallback(
        @Body() body: ProviderCallbackDto,
        @Req() request: RawBodyRequest<Request>,
        @Headers('x-provider-timestamp') timestamp: string | undefined,
        @Headers('x-provider-signature') signature: string | undefined,
    ) {

        if (!request.rawBody) {
            throw new BadRequestException('Raw request body is unavailable');
        }

        return this.providerCallbacksService.handleCallback({
            body,
            rawBody: request.rawBody,
            timestamp,
            signature,
        });
    }

    /**
     * Authenticates NOWPayments using its sorted-key JSON IPN signature.
     */
    @Post('nowpayments')
    @HttpCode(HttpStatus.OK)
    async handleNowPaymentsCallback(
        @Body() body: unknown,
        @Req() request: RawBodyRequest<Request>,
        @Headers('x-nowpayments-sig') signature: string | undefined,
    ) {
        const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;

          if (
              !request.rawBody ||
              !ipnSecret ||
              !verifyNowPaymentsIpnSignature(body, signature, ipnSecret)
          ) {
            throw new UnauthorizedException('Invalid or missing callback signature');
        }

          const losslessBody = parseLosslessNowPaymentsJson(
              request.rawBody.toString('utf8'),
          );
          if (!isNowPaymentsIpnPayload(losslessBody)) {
            throw new BadRequestException('Unrecognized NOWPayments callback payload');
        }

          return this.providerCallbacksService.handleNowPaymentsCallback(losslessBody);
    }
}