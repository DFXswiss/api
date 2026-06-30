import { DfxLogger } from '../../services/dfx-logger';
import { apiTraceMiddleware } from '../api-trace.middleware';

function runTrace(req: any, statusCode: number, responseBody: unknown): string {
  const spy = jest.spyOn(DfxLogger.prototype, 'info').mockImplementation(() => undefined);

  let finish: () => void = () => undefined;
  const res: any = {
    statusCode,
    json: (body: unknown) => body,
    send: (body: unknown) => body,
    on: (event: string, cb: () => void) => {
      if (event === 'finish') finish = cb;
    },
  };

  apiTraceMiddleware()(req, res, () => undefined);
  res.json(responseBody); // captured by the middleware's override
  finish();

  const line = spy.mock.calls.map((c) => c.join(' ')).join('\n');
  spy.mockRestore();
  return line;
}

describe('apiTraceMiddleware', () => {
  // All values below are synthetic placeholders (example.com / RFC 5737 TEST-NET IP /
  // dummy wallet) — never real user data.
  const req = {
    method: 'POST',
    originalUrl: '/v1/realunit/buy/0x1234567890123456789012345678901234567890/confirm?ref=abc',
    headers: {
      'x-client': 'realunit-app',
      'content-type': 'application/json',
      'x-forwarded-for': '192.0.2.1',
      'cf-connecting-ip': '192.0.2.1',
      cookie: 'session=dummy-session-value',
      authorization: 'Bearer dummy.jwt.value',
    },
    body: {
      email: 'jane.doe@example.com',
      name: 'Jane Doe',
      phoneNumber: '+41790000000',
      addressStreet: 'Teststrasse 1',
      addressPostalCode: '0000',
      addressCity: 'Testtown',
      walletAddress: '0x1234567890123456789012345678901234567890',
      amount: 50,
    },
  };
  const responseBody = { status: 'CONFIRMED', error: 'Not Found', ref: 'jane.doe@example.com' };

  const line = runTrace(req, 201, responseBody);

  it('logs a single line', () => {
    expect(line).not.toContain('\n');
  });

  it('keeps the non-personal trace data', () => {
    expect(line).toContain('POST');
    expect(line).toContain('→ 201');
    expect(line).toContain('client=realunit-app');
    expect(line).toContain('"amount":50');
    expect(line).toContain('"status":"CONFIRMED"');
  });

  it.each([
    ['email', 'jane.doe@example.com'],
    ['email local part', 'jane.doe'],
    ['name', 'Jane Doe'],
    ['phone', '41790000000'],
    ['street', 'Teststrasse'],
    ['city', 'Testtown'],
    ['postal code', '0000'],
    ['client IP', '192.0.2.1'],
    ['wallet address', '1234567890123456789012345678901234567890'],
    ['cookie value', 'dummy-session-value'],
    ['auth token', 'dummy.jwt.value'],
  ])('does not leak the %s', (_label, secret) => {
    expect(line).not.toContain(secret);
  });

  it('masks the wallet address in the path', () => {
    expect(line).toContain('/v1/realunit/buy/0x…/confirm');
  });

  it('drops the query string', () => {
    expect(line).not.toContain('ref=abc');
  });
});
