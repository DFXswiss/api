import { TravelRuleSignature } from './travel-rule-signature';

describe('TravelRuleSignature', () => {
  describe('isValid', () => {
    // *** EMPTY / MISSING INPUT (fail-closed) *** //

    it('rejects an undefined signature', () => {
      expect(TravelRuleSignature.isValid(undefined)).toBe(false);
    });

    it('rejects a null signature', () => {
      expect(TravelRuleSignature.isValid(null as unknown as string)).toBe(false);
    });

    it('rejects an empty string', () => {
      expect(TravelRuleSignature.isValid('')).toBe(false);
    });

    // *** ALLOWLISTED FORMATS (each exactly one hit) *** //

    it('accepts an EVM personal_sign signature (0x + 130 hex)', () => {
      expect(TravelRuleSignature.isValid(`0x${'a'.repeat(130)}`)).toBe(true);
    });

    it('accepts the long EVM variant (0x + 146 hex)', () => {
      expect(TravelRuleSignature.isValid(`0x${'b'.repeat(146)}`)).toBe(true);
    });

    it('accepts a Cardano CIP-30 COSE signature (hex prefix 8458)', () => {
      expect(TravelRuleSignature.isValid('8458200a4010103272006215820deadbeef')).toBe(true);
    });

    it('accepts a Cardano CIP-30 COSE signature with a ;<key> suffix (validates the signature part)', () => {
      expect(TravelRuleSignature.isValid('8458200a;a4010103272006215820deadbeef')).toBe(true);
    });

    it('accepts a Bitcoin message signature (base64, H… prefix)', () => {
      expect(TravelRuleSignature.isValid(`H${'A'.repeat(87)}=`)).toBe(true);
    });

    it('accepts a Monero signature (long base58, no 0/O/I/l)', () => {
      expect(TravelRuleSignature.isValid('1'.repeat(95))).toBe(true);
    });

    // *** EXPLICITLY EXCLUDED: masterKey UUID (no cryptographic ownership proof) *** //

    it('rejects a plain UUID (worthless masterKey pseudo-signature)', () => {
      expect(TravelRuleSignature.isValid('00000000-0000-4000-8000-000000000000')).toBe(false);
    });

    it('rejects a UUID with a ;<key> suffix (signature part is still a UUID)', () => {
      expect(TravelRuleSignature.isValid('00000000-0000-4000-8000-000000000000;deadbeef')).toBe(false);
    });

    // *** NON-ALLOWLISTED ARTEFACTS / FORMATS *** //

    it('rejects an unrecognised artefact string ("Link")', () => {
      expect(TravelRuleSignature.isValid('Link')).toBe(false);
    });

    it('rejects a Lightning-style signature (lowercase hex, no 0x prefix)', () => {
      // leading `0` excludes the Monero base58 format (which forbids 0/O/I/l) and the missing `0x`
      // prefix excludes the EVM formats → a deterministically non-allowlisted lowercase-hex value
      expect(TravelRuleSignature.isValid(`0${'a'.repeat(143)}`)).toBe(false);
    });

    it('rejects a random short string', () => {
      expect(TravelRuleSignature.isValid('not-a-signature')).toBe(false);
    });
  });
});
