import { baseUnitsTransformer, fromDecimalString, toBaseUnits } from '../base-units.transformer';

describe('base units transformer', () => {
  describe('fromDecimalString (exact, never via float)', () => {
    it('preserves full 18-dp wei precision a float / 8-dp path would lose', () => {
      // 1 wei = 0.000000000000000001 ETH: parseFloat + an 8-dp cap would collapse this to 0
      expect(fromDecimalString('0.000000000000000001', 18)).toBe(1n);
      // an 18-dp mantissa beyond a double's 2^53 exact-integer range
      expect(fromDecimalString('0.123456789012345678', 18)).toBe(123456789012345678n);
      expect(fromDecimalString('1.000000000000000001', 18)).toBe(1000000000000000001n);
    });

    it('scales an exact integer / plain decimal string sign-aware', () => {
      expect(fromDecimalString('1', 18)).toBe(1000000000000000000n);
      expect(fromDecimalString('1.0', 18)).toBe(1000000000000000000n); // ethers formatUnits emits a trailing .0
      expect(fromDecimalString('0.0001', 8)).toBe(10000n); // 0.0001 BTC = 10'000 sat
      expect(fromDecimalString('-1.5', 8)).toBe(-150000000n);
      expect(fromDecimalString('2.5', 6)).toBe(2500000n); // USDC
      expect(fromDecimalString('0', 18)).toBe(0n);
      expect(fromDecimalString('-0', 8)).toBe(0n); // negative zero normalises to 0n
      expect(fromDecimalString('123456', 0)).toBe(123456n);
    });

    it('fails loud rather than silently truncating more precision than the asset scale', () => {
      expect(() => fromDecimalString('0.0000001', 6)).toThrow(/more than 6 fractional digits/);
      expect(() => fromDecimalString('1.23', 0)).toThrow(/more than 0 fractional digits/);
    });

    it('rejects a non-decimal source string', () => {
      expect(() => fromDecimalString('0x1a', 18)).toThrow(/not a decimal number/);
      expect(() => fromDecimalString('1e18', 18)).toThrow(/not a decimal number/);
      expect(() => fromDecimalString('', 18)).toThrow(/not a decimal number/);
    });
  });

  // the moved toBaseUnits + transformer keep their contract (the accounting re-export still points here)
  describe('toBaseUnits + baseUnitsTransformer (moved to shared)', () => {
    it('scales an 8-dp float to satoshi and maps numeric <-> bigint', () => {
      expect(toBaseUnits(1, 8)).toBe(100000000n);
      expect(baseUnitsTransformer.from('150000000')).toBe(150000000n);
      expect(baseUnitsTransformer.to(150000000n)).toBe('150000000');
      expect(baseUnitsTransformer.from(null)).toBeNull();
    });

    it('fails loud on a non-integer persisted value', () => {
      expect(() => baseUnitsTransformer.from('12.5')).toThrow(/not an integer/);
    });
  });
});
