import { toBitboxAscii } from '../bitbox-ascii.util';

describe('toBitboxAscii', () => {
  it('returns ASCII input unchanged', () => {
    expect(toBitboxAscii('Joshua Krueger')).toBe('Joshua Krueger');
    expect(toBitboxAscii('')).toBe('');
    expect(toBitboxAscii('123 Main St')).toBe('123 Main St');
  });

  it('expands German umlauts with digraph romanization', () => {
    expect(toBitboxAscii('Krüger')).toBe('Krueger');
    expect(toBitboxAscii('Müller')).toBe('Mueller');
    expect(toBitboxAscii('Über')).toBe('Ueber');
    expect(toBitboxAscii('Größe')).toBe('Groesse');
    expect(toBitboxAscii('STRAẞE')).toBe('STRASSE');
  });

  it('expands Nordic æ/ø to digraphs', () => {
    expect(toBitboxAscii('Æsir')).toBe('Aesir');
    expect(toBitboxAscii('Mørk')).toBe('Moerk');
    expect(toBitboxAscii('Þór')).toBe('Thor');
  });

  it('strips accents from Latin-script letters', () => {
    expect(toBitboxAscii('Garção')).toBe('Garcao');
    expect(toBitboxAscii('Łódź')).toBe('Lodz');
    expect(toBitboxAscii('Naïve')).toBe('Naive');
    expect(toBitboxAscii('Ångström')).toBe('Angstroem');
  });

  it('replaces unmapped non-ASCII runes with ?', () => {
    expect(toBitboxAscii('hello 你好')).toBe('hello ??');
    expect(toBitboxAscii('emoji 🙂')).toMatch(/^emoji \?+$/);
  });

  it('treats name from production incident as expected', () => {
    expect(toBitboxAscii('Joshua Krüger')).toBe('Joshua Krueger');
  });
});
