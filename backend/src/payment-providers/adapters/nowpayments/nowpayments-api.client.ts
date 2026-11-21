import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CreatePaymentParams {
  priceAmount: number;       // in priceCurrency's major unit, e.g. 19.99
  priceCurrency: string;     // e.g. 'usd'
  payCurrency: string;       // e.g. 'usdttrc20'
  orderId: string;           // use the attemptReference — must be unique per NOWPayments payment
  orderDescription?: string;
  ipnCallbackUrl: string;
}

export interface NowPaymentsPaymentResponse {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  order_id: string;
  order_description?: string;
  purchase_id?: string;
  created_at: string;
  updated_at: string;
  expiration_estimate_date?: string;
  network?: string;
}

/**
 * Thin, typed wrapper over NOWPayments' v1 REST API. Deliberately does not
 * retry mutating calls (create payment) automatically — a retried
 * create-payment with the same order_id can produce ambiguous state on
 * their side. Retries belong at the caller, keyed on NOWPayments'
 * idempotency semantics, not blindly here.
 */
@Injectable()
export class NowPaymentsApiClient {
  private readonly logger = new Logger(NowPaymentsApiClient.name);

  constructor(private readonly configService: ConfigService) {}

  private get apiKey(): string {
    const key = this.configService.get<string>('nowpayments.apiKey');
    if (!key) {
      throw new ServiceUnavailableException(
        'NOWPayments API key is not configured.',
      );
    }
    return key;
  }

  private get baseUrl(): string {
    return this.configService.get<string>('nowpayments.baseUrl')!;
  }

  async createPayment(
    params: CreatePaymentParams,
  ): Promise<NowPaymentsPaymentResponse> {
    const response = await this.request('/payment', 'POST', {
      price_amount: params.priceAmount,
      price_currency: params.priceCurrency,
      pay_currency: params.payCurrency,
      order_id: params.orderId,
      order_description: params.orderDescription,
      ipn_callback_url: params.ipnCallbackUrl,
    });

    return response as NowPaymentsPaymentResponse;
  }

  async getPaymentStatus(
    paymentId: string,
  ): Promise<NowPaymentsPaymentResponse> {
    const response = await this.request(`/payment/${paymentId}`, 'GET');
    return response as NowPaymentsPaymentResponse;
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        ...(method === 'POST' && body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.error(`NOWPayments request failed: ${method} ${path}`, error as Error);
      throw new ServiceUnavailableException(
        'Unable to reach the NOWPayments API.',
      );
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      this.logger.error(`NOWPayments returned non-JSON response: ${text.slice(0, 500)}`);
      throw new BadGatewayException('NOWPayments returned an unexpected response.');
    }

    if (!response.ok) {
      this.logger.warn(
        `NOWPayments ${method} ${path} returned ${response.status}: ${JSON.stringify(parsed)}`,
      );
      throw new BadGatewayException(
        `NOWPayments rejected the request (${response.status}).`,
      );
    }

    return parsed;
  }
}