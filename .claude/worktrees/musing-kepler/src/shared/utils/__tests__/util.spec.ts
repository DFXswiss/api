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
