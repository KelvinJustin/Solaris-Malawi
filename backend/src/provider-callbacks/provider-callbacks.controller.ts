import {
    BadRequestException,
    Body,
    Controller,
    Headers,
    HttpCode,
    HttpStatus,
    Post,
    Req,
} from '@nestjs/common';

import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { ProviderCallbackDto } from './dto/provider-callback.dto.js';
import { ProviderCallbacksService } from './provider-callbacks.service.js';

@Controller('provider-callbacks')
export class ProviderCallbacksController {
    constructor(
        private readonly providerCallbacksService: ProviderCallbacksService,
    ) { }

    /**
     * Receives signed payment-status notifications from payment providers.
     *
     * The raw request body is required because the HMAC signature must be
     * verified against the exact bytes sent by the provider.
     */

    @Post()
    @HttpCode(HttpStatus.OK)
    async handleCallback(
        @Body() body: ProviderCallbackDto,
        @Req() request: RawBodyRequest<Request>,
        @Headers('x-provider-timestamp') timestamp: string | undefined,
        @Headers('x-provider-signature') signature: string | undefined,
    ) {
        console.log(
            `[callback] incoming  ref=${body.providerReference}  attempt=${body.attemptReference}  status=${body.status}  sig=${signature?.slice(0, 12) ?? 'missing'}...`
        );

        if (!request.rawBody) {
            throw new BadRequestException('Raw request body is unavailable');
        }

        let result: { received: boolean; duplicate: boolean };

        try {
            result = await this.providerCallbacksService.handleCallback({
                body,
                rawBody: request.rawBody,
                timestamp,
                signature,
            });
        } catch (error: any) {
            console.error(
                `[callback] failed  ref=${body.providerReference}  attempt=${body.attemptReference}  error=${error.message}`
            );
            throw error;
        }

        console.log(
            `[callback] settled  ref=${body.providerReference}  attempt=${body.attemptReference}  duplicate=${result.duplicate}`
        );

        return result;
    }
}
