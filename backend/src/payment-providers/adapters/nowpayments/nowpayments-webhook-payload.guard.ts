import type { NowPaymentsStatus } from './nowpayments-status.util.js';

export interface NowPaymentsIpnPayload {
  payment_id: string;
  payment_status: NowPaymentsStatus;
  actually_paid?: string;
  pay_amount?: string;
  order_id?: string;
}

const supportedStatuses = new Set<NowPaymentsStatus>([
  'waiting',
  'confirming',
  'confirmed',
  'sending',
  'partially_paid',
  'finished',
  'failed',
  'expired',
  'refunded',
]);

export function isNowPaymentsIpnPayload(value: unknown): value is NowPaymentsIpnPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.payment_id === 'string' &&
    record.payment_id.length > 0 &&
    typeof record.payment_status === 'string' &&
    supportedStatuses.has(record.payment_status as NowPaymentsStatus) &&
    (record.actually_paid === undefined ||
      (typeof record.actually_paid === 'string' &&
        /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(
          record.actually_paid,
        ))) &&
    (record.pay_amount === undefined ||
      (typeof record.pay_amount === 'string' &&
        /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(
          record.pay_amount,
        ))) &&
    (record.order_id === undefined || typeof record.order_id === 'string')
  );
}