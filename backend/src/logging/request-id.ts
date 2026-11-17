import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function createRequestId(request: Pick<IncomingMessage, 'headers'>): string {
  const requestId = request.headers['x-request-id'];

  return typeof requestId === 'string' && SAFE_REQUEST_ID.test(requestId)
    ? requestId
    : randomUUID();
}
