import { baseUnitsTransformer, toBaseUnits } from '../ledger-base-units.transformer';

describe('ledger base units', () => {
  describe('toBaseUnits', () => {
    it('scales an 8-decimal (BTC) amount to satoshi exactly, sign-aware', () => {
      expect(toBaseUnits(0.0001, 8)).toBe(10000n); // 0.0001 BTC = 10'000 sat
      expect(toBaseUnits(1, 8)).toBe(100000000n);
      expect(toBaseUnits(-1.5, 8)).toBe(-150000000n);
      expect(toBaseUnits(0, 8)).toBe(0n);
    });

    it('scales an 18-decimal (ETH) amount to wei without JS-number overflow', () => {
      expect(toBaseUnits(0.0001, 18)).toBe(100000000000000n); // 1e14
      expect(toBaseUnits(1000, 18)).toBe(1000000000000000000000n); // 1e21 wei (> 2^53, still exact)
    });

    it('scales a 6-decimal (USDC) amount exactly', () => {
      expect(toBaseUnits(2.5, 6)).toBe(2500000n);
    });

    it('does not amplify float binary error beyond the 8-dp source precision', () => {
      expect(toBaseUnits(0.1, 18)).toBe(100000000000000000n); // exactly 1e17 wei, NOT 100000000000000006
    });
  });

  describe('baseUnitsTransformer', () => {
    it('maps a numeric string to bigint and a bigint to a string', () => {
      expect(baseUnitsTransformer.from('1000000000000000000000')).toBe(1000000000000000000000n);
      expect(baseUnitsTransformer.to(150000000n)).toBe('150000000');
    });

    it('maps null through in both directions', () => {
      expect(baseUnitsTransformer.from(null)).toBeNull();
      expect(baseUnitsTransformer.to(null)).toBeNull();
      expect(baseUnitsTransformer.to(undefined)).toBeNull();
    });

    it('fails loud on a non-integer value (refuses to silently truncate)', () => {
      expect(() => baseUnitsTransformer.from('12.5')).toThrow(/not an integer/);
    });
  });
});
