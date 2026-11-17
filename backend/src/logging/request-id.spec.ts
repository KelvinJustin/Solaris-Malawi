import { describe, expect, it } from 'vitest';
import { createRequestId } from './request-id.js';

describe('createRequestId', () => {
  it('accepts a bounded safe request ID', () => {
    expect(
      createRequestId({ headers: { 'x-request-id': 'request-123' } }),
    ).toBe('request-123');
  });

  it.each(['bad id', 'line\nbreak', 'x'.repeat(129)])(
    'replaces an unsafe request ID',
    (requestId) => {
      expect(
        createRequestId({ headers: { 'x-request-id': requestId } }),
      ).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('generates an ID when the header is missing or duplicated', () => {
    expect(createRequestId({ headers: {} })).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      createRequestId({ headers: { 'x-request-id': ['one', 'two'] } }),
    ).toMatch(/^[0-9a-f-]{36}$/);
  });
});
