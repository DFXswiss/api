import { GetConfig } from 'src/config/config';

describe('Config.defaults', () => {
  const config = GetConfig();

  describe('forCountry', () => {
    it('uses the global fallback for a country without an entry', () => {
      expect(config.defaults.forCountry('US')).toEqual({ currency: 'EUR', language: 'EN' });
      // No country at all (e.g. an IP without a geo match) must resolve, not throw.
      expect(config.defaults.forCountry(undefined)).toEqual({ currency: 'EUR', language: 'EN' });
      expect(config.defaults.forCountry()).toEqual({ currency: 'EUR', language: 'EN' });
    });

    it('overrides both currency and language where the country pins both', () => {
      expect(config.defaults.forCountry('LI')).toEqual({ currency: 'CHF', language: 'DE' });
    });

    // Switzerland is multilingual, so it deliberately pins only the currency and keeps the global
    // language fallback — a language default per country must not be invented here.
    it('keeps the global language for Switzerland while switching the currency to CHF', () => {
      expect(config.defaults.forCountry('CH')).toEqual({ currency: 'CHF', language: 'EN' });
    });

    it('keeps the global currency for countries that pin only the language', () => {
      expect(config.defaults.forCountry('DE')).toEqual({ currency: 'EUR', language: 'DE' });
      expect(config.defaults.forCountry('AT')).toEqual({ currency: 'EUR', language: 'DE' });
      expect(config.defaults.forCountry('IT')).toEqual({ currency: 'EUR', language: 'IT' });
      expect(config.defaults.forCountry('FR')).toEqual({ currency: 'EUR', language: 'FR' });
    });
  });

  describe('isDomesticIban', () => {
    // "Domestic" drives which bank rail (and therefore which fee/AML path) a transfer takes, so it
    // is decided by the IBAN country prefix alone.
    it('treats Swiss and Liechtenstein IBANs as domestic', () => {
      expect(config.isDomesticIban('CH2108307000289537320')).toBe(true);
      expect(config.isDomesticIban('LI21088100002324013AA')).toBe(true);
    });

    it('treats every other country as foreign', () => {
      expect(config.isDomesticIban('DE89370400440532013000')).toBe(false);
      expect(config.isDomesticIban('AT611904300234573201')).toBe(false);
    });

    it('returns false instead of throwing for a missing IBAN', () => {
      expect(config.isDomesticIban(undefined)).toBe(false);
      expect(config.isDomesticIban('')).toBe(false);
    });
  });

  describe('i18n', () => {
    // nestjs-i18n asks the resolver for the request language; this single resolver pins every
    // request to the configured fallback, so the fallback and the resolver must not drift apart.
    it('resolves every request to the lower-cased fallback language', () => {
      expect(config.i18n.fallbackLanguage).toBe('en');

      const [resolver] = config.i18n.resolvers as unknown as { resolve: () => string }[];

      expect(resolver.resolve()).toBe('en');
    });
  });

  describe('prefixes and uid formats', () => {
    it('keeps every uid prefix distinct so a uid identifies its entity type', () => {
      const values = Object.values(config.prefixes);

      expect(new Set(values).size).toBe(values.length);
    });

    it('validates a transaction uid against the transaction prefix', () => {
      const uid = `${config.prefixes.transactionUidPrefix}${'a'.repeat(16)}`;

      expect(config.formats.transactionUid.test(uid)).toBe(true);
      // Wrong prefix or wrong length must not pass.
      expect(config.formats.transactionUid.test(`X${'a'.repeat(16)}`)).toBe(false);
      expect(config.formats.transactionUid.test(`${config.prefixes.transactionUidPrefix}${'a'.repeat(15)}`)).toBe(
        false,
      );
    });
  });

  describe('formats.swissPaymentText', () => {
    // SIX SIG IG QR-Bill v2.3 character set: everything stored in a name/address field has to be
    // renderable by Helvetica/WinAnsi, otherwise Swiss banks reject the payment slip.
    it('accepts printable ASCII, the Swiss national-language diacritics and line breaks', () => {
      expect(config.formats.swissPaymentText.test('Mueller-Oeztuerk, Rue de la Gare 3')).toBe(true);
      expect(config.formats.swissPaymentText.test('Zürich Öhningen Àlvarez Français Straße')).toBe(true);
      expect(config.formats.swissPaymentText.test('Bahnhofstrasse 7\n6300 Zug')).toBe(true);
    });

    it('rejects characters no Swiss bank would render', () => {
      // Typographic apostrophe — the single most common paste-in from a word processor.
      expect(config.formats.swissPaymentText.test('Rue de l’Église 3')).toBe(false);
      expect(config.formats.swissPaymentText.test('DFX ★ AG')).toBe(false);
      expect(config.formats.swissPaymentText.test('Đorđević')).toBe(false);
    });
  });

  describe('formats.signature', () => {
    it('accepts an EVM and a Bitcoin signature', () => {
      expect(config.formats.signature.test(`0x${'a'.repeat(130)}`)).toBe(true);
      expect(config.formats.signature.test('a'.repeat(130))).toBe(true);
      expect(config.formats.signature.test(`${'A'.repeat(87)}=`)).toBe(true);
    });

    it('rejects a value matching none of the supported signature formats', () => {
      expect(config.formats.signature.test('not a signature!')).toBe(false);
      expect(config.formats.signature.test('')).toBe(false);
    });
  });
});
