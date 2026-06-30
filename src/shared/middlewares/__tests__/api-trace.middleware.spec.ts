import { DfxLogger } from '../../services/dfx-logger';
import { apiTraceMiddleware } from '../api-trace.middleware';

type Emit = (res: any) => void;

function runTrace(req: any, statusCode: number, emit?: Emit): { lines: string[]; nextCalled: boolean } {
  const spy = jest.spyOn(DfxLogger.prototype, 'info').mockImplementation(() => undefined);

  let finish: () => void = () => undefined;
  const res: any = {
    statusCode,
    // Model Express: res.json() delegates to res.send() (so the send override is exercised).
    json(body: unknown) {
      return this.send(body);
    },
    send(body: unknown) {
      return body;
    },
    on(event: string, cb: () => void) {
      if (event === 'finish') finish = cb;
    },
  };

  let nextCalled = false;
  apiTraceMiddleware()(req, res, () => {
    nextCalled = true;
  });
  if (emit) emit(res);
  finish();

  const lines = spy.mock.calls.map((c) => c.join(' '));
  spy.mockRestore();
  return { lines, nextCalled };
}

const realunitReq = (body: unknown) => ({
  method: 'POST',
  originalUrl: '/v1/realunit/buy/0x1234567890123456789012345678901234567890/confirm?ref=abc',
  headers: {
    'x-client': 'realunit-app',
    'content-type': 'application/json',
    'x-forwarded-for': '192.0.2.1',
    cookie: 'session=dummy-session-value',
    authorization: 'Bearer dummy.jwt.value',
  },
  body,
});

describe('apiTraceMiddleware', () => {
  describe('realunit path — full redacted trace (via res.json → res.send)', () => {
    const req = realunitReq({
      email: 'jane.doe@example.com',
      name: 'Jane Doe',
      phoneNumber: '+41790000000',
      bic: 'TESTCHBEXXX',
      kycData: {
        firstName: 'Jane',
        addressStreet: 'Teststrasse 1',
        addressPostalCode: '8001ABC',
        addressCity: 'Testtown',
        documentNumber: 'X1234567',
      },
      walletAddress: '0x1234567890123456789012345678901234567890',
      txHash: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      amount: 50,
    });
    const { lines } = runTrace(req, 201, (res) => res.json({ status: 'CONFIRMED', error: 'Not Found' }));
    const line = lines.join('\n');

    it('logs exactly one line', () => {
      expect(lines).toHaveLength(1);
      expect(line).not.toContain('\n');
    });

    it('keeps the non-personal data', () => {
      expect(line).toContain('POST');
      expect(line).toContain('→ 201');
      expect(line).toContain('client=realunit-app');
      expect(line).toContain('"amount":50');
      expect(line).toContain('"status":"CONFIRMED"');
    });

    it.each([
      ['email', 'jane.doe@example.com'],
      ['name', 'Jane Doe'],
      ['nested firstName', '"firstName":"Jane"'],
      ['nested street', 'Teststrasse'],
      ['nested postal code', '8001ABC'],
      ['nested document number', 'X1234567'],
      ['phone', '41790000000'],
      ['bic', 'TESTCHBEXXX'],
      ['client IP', '192.0.2.1'],
      ['cookie value', 'dummy-session-value'],
      ['auth token', 'dummy.jwt.value'],
    ])('masks the %s', (_label, secret) => {
      expect(line).not.toContain(secret);
    });

    it('masks the wallet address in path and body but keeps the tx hash intact', () => {
      expect(line).toContain('/v1/realunit/buy/0x…/confirm');
      expect(line).toContain('"walletAddress":"***"');
      expect(line).toContain('0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
    });

    it('drops the query string', () => {
      expect(line).not.toContain('ref=abc');
    });
  });

  it('captures a response sent via res.send only', () => {
    const { lines } = runTrace(realunitReq({ amount: 1 }), 200, (res) =>
      res.send({ secretMail: 'x@example.com', ok: true }),
    );
    const line = lines.join('\n');
    expect(line).toContain('"ok":true');
    expect(line).not.toContain('x@example.com');
  });

  it('truncates oversized strings and summarizes binary bodies', () => {
    const big = 'A'.repeat(600);
    const { lines } = runTrace(realunitReq({ note: big, img: Buffer.from('PNGDATA') }), 200, (res) => res.json({}));
    const line = lines.join('\n');
    expect(line).not.toContain(big);
    expect(line).toContain('600 chars');
    expect(line).toContain('<binary 7 bytes>');
  });

  it('logs metadata-only for a realunit-app call to a non-realunit path', () => {
    const req = {
      method: 'POST',
      originalUrl: '/v1/kyc/data',
      headers: { 'x-client': 'realunit-app' },
      body: { documentNumber: 'X1234567', gender: 'male' },
    };
    const { lines } = runTrace(req, 200, (res) => res.json({ documentNumber: 'X1234567' }));
    const line = lines.join('\n');
    expect(lines).toHaveLength(1);
    expect(line).toContain('POST /v1/kyc/data → 200');
    expect(line).not.toContain('req.body');
    expect(line).not.toContain('X1234567');
  });

  it('does not trace a non-realunit request at all', () => {
    const req = { method: 'GET', originalUrl: '/v1/transaction', headers: { 'x-client': 'dfx-app' }, body: {} };
    const { lines, nextCalled } = runTrace(req, 200, (res) => res.json({ ok: true }));
    expect(lines).toHaveLength(0);
    expect(nextCalled).toBe(true);
  });
});
