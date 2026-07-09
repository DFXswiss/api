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
