import { apiTraceMiddleware, maskLogValue } from 'src/shared/middlewares/api-trace.middleware';
import { DfxLogger } from 'src/shared/services/dfx-logger';

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
    let lines: string[];
    let line: string;

    beforeAll(() => {
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
      ({ lines } = runTrace(req, 201, (res) => res.json({ status: 'CONFIRMED', error: 'Not Found' })));
      line = lines.join('\n');
    });

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

  it('masks arrays under a sensitive key (tampered array param)', () => {
    const req = realunitReq({ mails: ['a@example.com', 'b@example.com'], tags: ['ok', 'fine'] });
    (req.headers as any)['x-forwarded-for'] = ['192.0.2.1', '192.0.2.2'];
    const { lines } = runTrace(req, 200, (res) => res.json({}));
    const line = lines.join('\n');
    expect(line).not.toContain('a@example.com');
    expect(line).not.toContain('192.0.2.2');
    expect(line).toContain('"tags":["ok","fine"]');
  });

  it('masks sell-broadcast signature material (unsignedTx / r / s / v)', () => {
    const { lines } = runTrace(
      realunitReq({
        unsignedTx: '0x02f87261e08459682f008459682f0e82520894',
        r: '0x1111111111111111111111111111111111111111111111111111111111111111',
        s: '0x2222222222222222222222222222222222222222222222222222222222222222',
        v: 27,
      }),
      200,
      (res) => res.json({}),
    );
    const line = lines.join('\n');
    expect(line).not.toContain('0x02f872');
    expect(line).not.toContain('0x1111');
    expect(line).not.toContain('0x2222');
    expect(line).toContain('"v":"***"');
  });

  it('masks an uppercase-hex wallet and an email in the path', () => {
    const req = {
      method: 'GET',
      originalUrl: '/v1/realunit/account/0X12345678901234567890123456789012345678AB/jane@example.com',
      headers: {},
      body: undefined,
    };
    const { lines } = runTrace(req, 404, (res) => res.send('Not Found'));
    const line = lines.join('\n');
    expect(line).toContain('/v1/realunit/account/0x…/***');
    expect(line).not.toContain('0X12345678');
    expect(line).not.toContain('jane@example.com');
  });

  it('stops redaction at the compute budget instead of walking a huge body', () => {
    const huge = { items: Array.from({ length: 50_000 }, (_, i) => `leaf-value-${i}-${'x'.repeat(400)}`) };
    const { lines } = runTrace(realunitReq(huge), 200, (res) => res.json({}));
    const line = lines.join('\n');
    expect(lines).toHaveLength(1);
    expect(line).not.toContain('leaf-value-49999');
    expect(line.length).toBeLessThan(3 * 4500); // each of the 3 sections stays within MAX_PART
    // the reported serialized size proves the walk stopped at the budget
    // instead of stringifying the whole ~20 MB body
    const [, serializedSize] = line.match(/req\.body=.*…\((\d+) code units\)/) ?? [];
    expect(Number(serializedSize)).toBeLessThan(10_000);
  });

  it('truncates oversized strings and summarizes binary bodies', () => {
    const big = 'A'.repeat(600);
    const { lines } = runTrace(realunitReq({ note: big, img: Buffer.from('PNGDATA') }), 200, (res) => res.json({}));
    const line = lines.join('\n');
    expect(line).not.toContain(big);
    expect(line).toContain('600 chars');
    expect(line).toContain('<binary 7 bytes>');
  });

  it('cuts an oversized section between characters, so the section carries no stray surrogate', () => {
    // Every value stays under MAX_STRING, so the section is cut by its own cap rather than the
    // per-string one; the padding puts an astral character across that cut.
    const notes = Array.from({ length: 9 }, () => 'b'.repeat(400));
    const withPadding = (padding: number): { notes: string[] } => ({
      notes: [...notes, `${'c'.repeat(padding)}${'\u{1F600}'.repeat(10)}`],
    });
    let padding = 0;
    while (JSON.stringify(withPadding(padding)).indexOf('\u{1F600}') < 4000 - 1) padding++;

    const { lines } = runTrace(realunitReq(withPadding(padding)), 200, (res) => res.json({}));
    const line = lines.join('\n');

    expect(line).toContain('code units)');
    expect(line).not.toContain('\ufffd');
    // no lone surrogate: a well-formed pair is one character with a code point above the range
    const isLoneSurrogate = (character: string): boolean => {
      const codePoint = character.codePointAt(0) as number;
      return codePoint >= 0xd800 && codePoint <= 0xdfff;
    };
    expect([...line].some(isLoneSurrogate)).toBe(false);
  });

  it('keeps the request target on one line as well', () => {
    const req = {
      method: 'GET',
      originalUrl: '/v1/realunit/account/x\u0085INFO [RealUnitTrace] forged line',
      headers: {},
      body: undefined,
    };
    const { lines } = runTrace(req, 404, (res) => res.send('Not Found'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\u0085');
    expect(lines[0]).toContain('/v1/realunit/account/xINFO');
  });

  it('renders the client header like any other value from the caller', () => {
    const req = realunitReq({ amount: 1 });
    req.headers['x-client'] = 'realunit-app\u0085INFO [RealUnitTrace] forged line';
    const { lines } = runTrace(req, 200, (res) => res.json({}));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\u0085');
    expect(lines[0]).toContain('client=realunit-appINFO');
  });

  it('masks a body key, not only the values under it', () => {
    // `redact` walks the values; the key is as much the request's to choose as the value is - and it
    // reached the line even without a character placed inside it.
    const plain = runTrace(realunitReq({ 'victim@example.com': 'x' }), 200, (res) => res.json({}));
    expect(plain.lines[0]).not.toContain('victim');
    expect(plain.lines[0]).toContain('***');

    const split = runTrace(realunitReq({ 'victim\u2028@example.com': 'x' }), 200, (res) => res.json({}));
    expect(split.lines[0]).not.toContain('victim');
    expect(split.lines[0]).toContain('***');
  });

  it('keeps the trace on one line, including the separators JSON.stringify leaves raw', () => {
    // `JSON.stringify` escapes the control characters, but not U+2028 / U+2029.
    const note = 'first\u2028second\u2029third\nfourth';
    const { lines } = runTrace(realunitReq({ note }), 200, (res) => res.json({}));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\u2028');
    expect(lines[0]).not.toContain('\u2029');
    expect(lines[0]).toContain('firstsecondthird');
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

describe('maskLogValue', () => {
  it('masks personal data in the value', () => {
    expect(maskLogValue('write to foo@bar.com', 100)).toBe('write to ***');
    expect(maskLogValue('from 10.0.0.1', 100)).toBe('from ***');
  });

  it('removes everything that could break the line — newline, ANSI escape, Unicode separators', () => {
    expect(maskLogValue('a\nb', 100)).toBe('ab');
    expect(maskLogValue('a\r\nb', 100)).toBe('ab');
    expect(maskLogValue('a\u001b[31mb', 100)).toBe('a[31mb');
    expect(maskLogValue('a\u2028b\u2029c', 100)).toBe('abc');
  });

  it('caps the value and marks the cut', () => {
    expect(maskLogValue('x'.repeat(10), 4)).toBe('xxxx\u2026');
    expect(maskLogValue('x'.repeat(4), 4)).toBe('xxxx');
  });

  it('cuts between characters, so a surrogate pair is not halved at the boundary', () => {
    const cut = maskLogValue(`${'a'.repeat(63)}\u{1F600}x`, 64);

    expect(cut).toBe(`${'a'.repeat(63)}\u{1F600}\u2026`);
    expect(cut).not.toContain('\uFFFD');
    expect([...cut].every((character) => character.codePointAt(0) !== 0xd83d)).toBe(true);
  });

  it('reports an oversized value by length instead of masking it', () => {
    // The caller's cap alone would still pay for masking the whole string first.
    expect(maskLogValue('x'.repeat(513), 96)).toBe('<513 code units>');
    expect(maskLogValue('x'.repeat(512), 96)).toContain('\u2026');
  });

  it('names the unit of the reported length, which counts code units and not characters', () => {
    // 257 astral characters are 514 code units: the value the guard compares and the one reported.
    expect(maskLogValue('\u{1F600}'.repeat(257), 96)).toBe('<514 code units>');
  });

  it('masks a pattern a control character was placed next to, which removing it would join', () => {
    // Removing the character puts what followed it against the end of the pattern, and the address
    // no longer ends on a word boundary - so the masking also runs before the removal.
    expect(maskLogValue('192.0.2.123\u0000a', 96)).toBe('***a');
    expect(maskLogValue(`0x${'a'.repeat(40)}\u0000b`, 96)).toBe('0x…b');
  });

  it('does not let the first pass become part of a match in the second', () => {
    // `***` is a valid local part as far as the address pattern is concerned, so a placeholder next
    // to an `@` would be folded into an address of its own and take the text after it with it.
    expect(maskLogValue('192.0.2.123\u2028@error.code', 96)).toBe('***@error.code');
    expect(maskLogValue(`0x${'a'.repeat(40)}\u2028@error.code`, 96)).toBe('0x…@error.code');
  });

  it('masks a pattern that a control character was placed inside', () => {
    // Removing the character rather than replacing it puts the pattern back together, so the
    // masking sees it as the value it is.
    expect(maskLogValue('0x1234567890abcdef1234\u0000567890abcdef12345678', 96)).toBe('0x…');
    expect(maskLogValue('192.0\u2028.2.123', 96)).toBe('***');
    expect(maskLogValue('victim\u0001@example.com', 96)).toBe('***');
  });

  it('masks before cutting, so a truncated email cannot slip through', () => {
    const masked = maskLogValue('someone@example.com', 12);

    expect(masked).not.toContain('someone@');
    expect(masked).toBe('***');
  });
});
