import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PaymentProvider } from '../../generated/prisma/enums.js';
import type {
  InitiatePaymentInput,
  PaymentProviderAdapter,
  ProviderInitiationResult,
} from '../contracts/payment-provider.interface.js';

/**
 * Scaffold only. This adapter is intentionally not registered until
 * NOWPayments API, webhook, and settlement behavior is implemented.
 */
@Injectable()
export class NowpaymentsAdapter implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.NOWPAYMENTS;

  async initiatePayment(
    _input: InitiatePaymentInput,
  ): Promise<ProviderInitiationResult> {
    throw new ServiceUnavailableException(
      'NOWPayments integration is not implemented.',
    );
  }
}
