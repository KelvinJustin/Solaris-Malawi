import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseLosslessNowPaymentsJson } from './nowpayments-json.util.js';

export interface CreatePaymentParams {
  priceAmount: string;
  priceCurrency: string;
  payAmount: string;
  payCurrency: string;
  orderId: string;
  orderDescription?: string;
  ipnCallbackUrl: string;
}

export interface NowPaymentsEstimateResponse {
  currency_from: string;
  amount_from: string;
  currency_to: string;
  estimated_amount: string;
}

export interface NowPaymentsApiStatusResponse {
  message: string;
}

export interface NowPaymentsPaymentResponse {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  price_amount: string;
  price_currency: string;
  pay_amount: string;
  pay_currency: string;
  order_id: string;
  order_description?: string;
  purchase_id?: string;
  created_at: string;
  updated_at: string;
  expiration_estimate_date?: string;
  network?: string;
}

const providerDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function isProviderDecimal(value: unknown): value is string {
  return typeof value === 'string' && providerDecimalPattern.test(value);
}

function isPaymentResponse(
  value: unknown,
): value is NowPaymentsPaymentResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.payment_id === 'string' &&
    record.payment_id.length > 0 &&
    typeof record.payment_status === 'string' &&
    typeof record.pay_address === 'string' &&
    record.pay_address.length > 0 &&
    isProviderDecimal(record.price_amount) &&
    typeof record.price_currency === 'string' &&
    isProviderDecimal(record.pay_amount) &&
    typeof record.pay_currency === 'string' &&
    typeof record.order_id === 'string' &&
    typeof record.created_at === 'string' &&
    typeof record.updated_at === 'string' &&
    (record.expiration_estimate_date === undefined ||
      typeof record.expiration_estimate_date === 'string') &&
    (record.network === undefined || typeof record.network === 'string')
  );
}

function isEstimateResponse(
  value: unknown,
): value is NowPaymentsEstimateResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.currency_from === 'string' &&
    isProviderDecimal(record.amount_from) &&
    typeof record.currency_to === 'string' &&
    isProviderDecimal(record.estimated_amount)
  );
}

function isApiStatusResponse(
  value: unknown,
): value is NowPaymentsApiStatusResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
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

  async getApiStatus(): Promise<NowPaymentsApiStatusResponse> {
    const response = await this.request('/status', 'GET', undefined, false);
    if (!isApiStatusResponse(response)) {
      throw new BadGatewayException(
        'NOWPayments returned an invalid API status response.',
      );
    }
    return response;
  }

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
    const decimalPattern = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
    if (
      !decimalPattern.test(params.priceAmount) ||
      !decimalPattern.test(params.payAmount)
    ) {
      throw new BadGatewayException('Payment amounts are not valid decimals.');
    }
    const body = [
      `"price_amount":${params.priceAmount}`,
      `"price_currency":${JSON.stringify(params.priceCurrency)}`,
      `"pay_amount":${params.payAmount}`,
      `"pay_currency":${JSON.stringify(params.payCurrency)}`,
      `"order_id":${JSON.stringify(params.orderId)}`,
      `"order_description":${JSON.stringify(params.orderDescription)}`,
      `"ipn_callback_url":${JSON.stringify(params.ipnCallbackUrl)}`,
    ].join(',');
    const response = await this.request('/payment', 'POST', `{${body}}`);

    if (!isPaymentResponse(response)) {
      throw new BadGatewayException(
        'NOWPayments returned an invalid payment response.',
      );
    }
    return response;
  }

  async getUsdEstimate(
    payCurrency: string,
  ): Promise<NowPaymentsEstimateResponse> {
    const query = new URLSearchParams({
      amount: '1',
      currency_from: 'usd',
      currency_to: payCurrency,
    });
    const response = await this.request(`/estimate?${query}`, 'GET');
    if (!isEstimateResponse(response)) {
      throw new BadGatewayException(
        'NOWPayments returned an invalid price estimate.',
      );
    }
    return response;
  }

  async getPaymentStatus(
    paymentId: string,
  ): Promise<NowPaymentsPaymentResponse> {
    const response = await this.request(`/payment/${paymentId}`, 'GET');
    if (!isPaymentResponse(response)) {
      throw new BadGatewayException(
        'NOWPayments returned an invalid payment response.',
      );
    }
    return response;
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: string,
    requiresApiKey = true,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (requiresApiKey) {
        headers['x-api-key'] = this.apiKey;
      }
      response = await fetch(url, {
        method,
        headers,
        ...(method === 'POST' && body ? { body } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.error(
        `NOWPayments request failed: ${method} ${path}`,
        error as Error,
      );
      throw new ServiceUnavailableException(
        'Unable to reach the NOWPayments API.',
      );
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? parseLosslessNowPaymentsJson(text) : undefined;
    } catch {
      this.logger.error(
        `NOWPayments returned non-JSON response: ${text.slice(0, 500)}`,
      );
      throw new BadGatewayException(
        'NOWPayments returned an unexpected response.',
      );
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
