import {
    Injectable,
    Inject,
    InternalServerErrorException,
} from '@nestjs/common';

import { PaymentProvider } from '../../generated/prisma/enums.js';
import type { PaymentProviderAdapter } from '../contracts/payment-provider.interface.js';

/**
 * NestJS injection token for the collection of payment adapters.
 *
 * Interfaces do not exist at runtime, so NestJS needs a concrete
 * token to inject the registered adapters.
 */
export const PAYMENT_PROVIDER_ADAPTERS = Symbol(
    'PAYMENT_PROVIDER_ADAPTERS',
);

@Injectable()
export class PaymentProviderRegistry {
    private readonly adapters = new Map<
        PaymentProvider,
        PaymentProviderAdapter
    >();

    constructor(
        @Inject(PAYMENT_PROVIDER_ADAPTERS)
        adapters: PaymentProviderAdapter[],
    ) {
        for (const adapter of adapters) {
            // A provider must have exactly one registered adapter.
            if (this.adapters.has(adapter.provider)) {
                throw new Error(
                    `Duplicate payment adapter registered for ${adapter.provider}.`,
                );
            }

            this.adapters.set(adapter.provider, adapter);
        }
    }

    /**
     * Resolve the adapter responsible for a selected payment provider.
     */
    get(provider: PaymentProvider): PaymentProviderAdapter {
        const adapter = this.adapters.get(provider);

        if (!adapter) {
            throw new InternalServerErrorException(
                `Payment provider ${provider} is not configured.`,
            );
        }

        return adapter;
    }
}