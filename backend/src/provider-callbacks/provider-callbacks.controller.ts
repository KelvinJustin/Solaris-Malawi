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
}
