
import { Controller, Get, NotFoundException, Param, Body, Post } from '@nestjs/common';

import { TransactionsService } from './transactions.service.js';
import { InitiateCheckoutPaymentDto } from './dto/initiate-checkout-payment.dto.js';

/**
 * Public endpoints used by customers opening a hosted checkout link.
 *
 * Do not add the merchant JwtAuthGuard to this controller.
 * Checkout-token validation is handled by TransactionsService.
 */
@Controller('checkout')
export class CheckoutController {
    constructor(
        private readonly transactionsService: TransactionsService,
    ) { }

    /**
     * Validate a checkout link and retrieve the public checkout details.
     */
    @Get(':token')
    async getCheckout(@Param('token') token: string) {
        if (!token || token.length > 200) {
            throw new NotFoundException('Checkout link is invalid or unavailable.');
        }

        return this.transactionsService.getCheckout(token);
    }

    /**
 * Request a payment initiation for an active checkout session.
 */
    @Post(':token/pay')
    async initiatePayment(
        @Param('token') token: string,
        @Body() dto: InitiateCheckoutPaymentDto,
    ) {
        if (!token || token.length > 200) {
            throw new NotFoundException(
                'Checkout link is invalid or unavailable.',
            );
        }

        return this.transactionsService.initiateCheckoutPayment(
            token,
            dto,
        );
    }
}
