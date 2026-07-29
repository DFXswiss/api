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
