import { Util } from '../util';

describe('NameComparison', () => {
  it('should be true', async () => {
    const result = Util.isSameName('Màx Müstermann', 'Max Mustêrmañn');
    expect(result).toBe(true);
  });

  it('should be true', async () => {
    const result = Util.isSameName('Màx Mueller', 'Mâx Peter Müllér');
    expect(result).toBe(true);
  });

  it('should be true', async () => {
    const result = Util.isSameName('Maex Moeller', 'Mäx Peter Möllér');
    expect(result).toBe(true);
  });

  it('should be true', async () => {
    const result = Util.isSameName('Mäximiliaen Koeppel', 'Maeximiliaen Koppel');
    expect(result).toBe(true);
  });

  it('should be true', async () => {
    const result = Util.isSameName('M. Mustermann', 'Max Mustermann');
    expect(result).toBe(true);
  });
});

describe('isoDateInTimeZone', () => {
  it('should roll over to the next day at CEST midnight (22:00 UTC in summer)', () => {
    expect(Util.isoDateInTimeZone('Europe/Luxembourg', new Date('2026-07-05T22:20:00Z'))).toBe('2026-07-06');
  });

  it('should match the UTC date before CEST midnight in summer', () => {
    expect(Util.isoDateInTimeZone('Europe/Luxembourg', new Date('2026-07-05T21:59:00Z'))).toBe('2026-07-05');
  });

  it('should roll over to the next day at CET midnight (23:00 UTC in winter)', () => {
    expect(Util.isoDateInTimeZone('Europe/Luxembourg', new Date('2026-01-05T23:20:00Z'))).toBe('2026-01-06');
  });

  it('should match the UTC date before CET midnight in winter', () => {
    expect(Util.isoDateInTimeZone('Europe/Luxembourg', new Date('2026-01-05T22:59:00Z'))).toBe('2026-01-05');
  });
});

describe('sanitizeLogValue', () => {
  it('replaces C0 control characters with ?', () => {
    const value = `a${String.fromCharCode(0x0a)}b${String.fromCharCode(0x09)}c`;
    expect(Util.sanitizeLogValue(value, 64)).toBe('a?b?c');
  });

  it('replaces DEL (0x7f)', () => {
    expect(Util.sanitizeLogValue(`a${String.fromCharCode(0x7f)}b`, 64)).toBe('a?b');
  });

  it('replaces C1 control characters such as NEL (0x85)', () => {
    expect(Util.sanitizeLogValue(`a${String.fromCharCode(0x85)}b`, 64)).toBe('a?b');
  });

  it('replaces LINE SEPARATOR (0x2028) and PARAGRAPH SEPARATOR (0x2029)', () => {
    const value = `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`;
    expect(Util.sanitizeLogValue(value, 64)).toBe('a?b?c');
  });

  it('preserves non-BMP characters within the maxLength limit', () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(Util.sanitizeLogValue(`hi${emoji}`, 64)).toBe(`hi${emoji}`);
  });

  it('truncates values longer than maxLength and appends a truncation marker', () => {
    expect(Util.sanitizeLogValue('abcdefghij', 5)).toBe('abcde...');
  });

  it('does not split a non-BMP character at the truncation boundary', () => {
    const emoji = String.fromCodePoint(0x1f600);
    const value = `${'x'.repeat(3)}${emoji}`;
    const result = Util.sanitizeLogValue(value, 3);

    expect(result).toBe('xxx...');
    expect(
      Array.from(result).every(
        (char) => char === '.' || char.codePointAt(0)! < 0xd800 || char.codePointAt(0)! > 0xdfff,
      ),
    ).toBe(true);
    expect(Util.sanitizeLogValue(value, 4)).toBe(value);
  });

  it('replaces comma (0x2c) so log field separators cannot be forged', () => {
    expect(Util.sanitizeLogValue('a,b', 64)).toBe('a?b');
  });

  it('replaces equals sign (0x3d) so log field separators cannot be forged', () => {
    expect(Util.sanitizeLogValue('a=b', 64)).toBe('a?b');
  });
});

describe('toDbId', () => {
  // Regression: request params were coerced with `!isNaN(+x)` / `Number.isInteger(+x)`, both of which
  // accept values Postgres rejects as an integer. Reaching SQL, they surfaced as 500s on endpoints
  // anonymous callers can reach (GET /v1/paymentLink/payment, /v1/plp, /v1/paymentLink/recipient).
  it.each(['Infinity', '-Infinity', '1.9', '1e+21', '1E5', '0x10', '0b11', '-1', 'abc', '', '  '])(
    'rejects %j',
    (value) => {
      expect(Util.toDbId(value)).toBeUndefined();
    },
  );

  it('rejects NaN, which the old isNaN(+x) coercion also caught', () => {
    expect(Util.toDbId('NaN')).toBeUndefined();
  });

  it('rejects 0, since SERIAL ids start at 1', () => {
    expect(Util.toDbId('0')).toBeUndefined();
  });

  it('rejects ids beyond the Postgres INTEGER range', () => {
    expect(Util.toDbId('2147483647')).toBe(2147483647);
    expect(Util.toDbId('2147483648')).toBeUndefined();
    expect(Util.toDbId('9'.repeat(309))).toBeUndefined();
  });

  // Query params are not guaranteed to be strings: `?id=1&id=2` arrives as an array, which
  // `RegExp.test` would coerce to a passing value.
  it.each([[['12']], [12], [null], [undefined], [{}]])('rejects the non-string %p', (value) => {
    expect(Util.toDbId(value)).toBeUndefined();
  });

  it('returns the parsed id for a plain positive integer', () => {
    expect(Util.toDbId('1')).toBe(1);
    expect(Util.toDbId('42')).toBe(42);
    expect(Util.toDbId('007')).toBe(7);
  });

  // A query string decodes `+` to a space, so `?id=+42` arrives padded and resolved before this
  // existed. Trimming lives here so every call site treats padding the same way.
  it.each([' 42', '42 ', ' 42 ', '\t42\n'])('tolerates the surrounding whitespace in %j', (value) => {
    expect(Util.toDbId(value)).toBe(42);
  });
});
