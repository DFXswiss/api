import { baseUnitsTransformer, fromBaseUnits, fromDecimalString, toBaseUnits } from '../base-units.transformer';

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

  describe('fromBaseUnits (exact inverse, never via float)', () => {
    it('renders full-precision decimals a float / 8-dp path would lose', () => {
      expect(fromBaseUnits(1n, 18)).toBe('0.000000000000000001'); // 1 wei
      expect(fromBaseUnits(123456789012345678n, 18)).toBe('0.123456789012345678');
      expect(fromBaseUnits(123456789012n, 12)).toBe('0.123456789012'); // piconero / zano atomic (12 dp)
    });

    it('trims trailing zeros so coarser asset scales stay representable', () => {
      expect(fromBaseUnits(1500000000000n, 12)).toBe('1.5'); // 1.5 XMR — round-trips even at 8 dp
      expect(fromBaseUnits(5000000000000n, 12)).toBe('5');
      expect(fromBaseUnits(1000000000000000000n, 18)).toBe('1');
      expect(fromBaseUnits(0n, 18)).toBe('0');
    });

    it('is sign-aware and never emits negative zero', () => {
      expect(fromBaseUnits(-150000000n, 8)).toBe('-1.5');
      expect(fromBaseUnits(-1n, 12)).toBe('-0.000000000001');
      expect(fromBaseUnits(123456n, 0)).toBe('123456');
    });

    it('round-trips exactly with fromDecimalString', () => {
      const wei = 123456789012345678n;
      expect(fromDecimalString(fromBaseUnits(wei, 18), 18)).toBe(wei);
      const piconero = 987654321098n;
      expect(fromDecimalString(fromBaseUnits(piconero, 12), 12)).toBe(piconero);
    });

    it('rejects invalid decimals', () => {
      expect(() => fromBaseUnits(1n, -1)).toThrow(/Invalid base-unit decimals/);
      expect(() => fromBaseUnits(1n, 1.5)).toThrow(/Invalid base-unit decimals/);
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
