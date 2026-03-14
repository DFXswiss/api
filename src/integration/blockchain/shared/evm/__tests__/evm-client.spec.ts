import { BigNumber as EthersNumber } from 'ethers';
import { EvmClient } from '../evm-client';

// Minimal concrete subclass to access protected method
class TestEvmClient extends EvmClient {
  constructor() {
    super(undefined as any);
  }

  testCalcPriceImpact(
    sqrtPriceX96Before: EthersNumber,
    sqrtPriceX96After: EthersNumber,
    token0IsIn: boolean,
  ): number {
    return this.calcPriceImpact(sqrtPriceX96Before, sqrtPriceX96After, token0IsIn);
  }
}

describe('EvmClient', () => {
  let client: TestEvmClient;

  beforeEach(() => {
    // constructor will throw on real init, but calcPriceImpact is pure math — no deps needed
    try {
      client = new TestEvmClient();
    } catch {
      // force-create instance bypassing constructor
      client = Object.create(TestEvmClient.prototype);
    }
  });

  describe('calcPriceImpact', () => {
    // sqrtPriceX96 = sqrt(price) * 2^96
    // For a price of 1.0: sqrtPriceX96 = 2^96 ≈ 7.922816e28
    const SQRT_PRICE_X96_1 = EthersNumber.from('79228162514264337593543950336'); // sqrt(1) * 2^96

    it('should return 0 when price does not change', () => {
      const result = client.testCalcPriceImpact(SQRT_PRICE_X96_1, SQRT_PRICE_X96_1, true);
      expect(result).toBe(0);
    });

    it('should return 0 when price does not change (token1 in)', () => {
      const result = client.testCalcPriceImpact(SQRT_PRICE_X96_1, SQRT_PRICE_X96_1, false);
      expect(result).toBe(0);
    });

    it('should return correct price impact for known sqrt ratio (token0 in)', () => {
      // sqrtPriceAfter / sqrtPriceBefore = 1.05
      // priceRatio = 1.05^2 = 1.1025
      // impact = |1 - 1.1025| = 0.1025
      const before = EthersNumber.from('79228162514264337593543950336'); // 2^96
      const after = EthersNumber.from('83189570639977557991658356736');  // 2^96 * 1.05

      const result = client.testCalcPriceImpact(before, after, true);
      expect(result).toBeCloseTo(0.1025, 4);
    });

    it('should return correct price impact for known sqrt ratio (token1 in)', () => {
      // When token1 is in, sqrtPriceRatio is inverted: 1/1.05
      // priceRatio = (1/1.05)^2 = 1/1.1025 ≈ 0.9070
      // impact = |1 - 0.9070| = 0.0930
      const before = EthersNumber.from('79228162514264337593543950336');
      const after = EthersNumber.from('83189570639977557991658356736');

      const result = client.testCalcPriceImpact(before, after, false);
      expect(result).toBeCloseTo(0.093, 3);
    });

    it('should handle price decrease (token0 in)', () => {
      // sqrtPriceAfter / sqrtPriceBefore = 0.95
      // priceRatio = 0.95^2 = 0.9025
      // impact = |1 - 0.9025| = 0.0975
      const before = EthersNumber.from('79228162514264337593543950336');
      const after = EthersNumber.from('75266754388551117195429543936');  // 2^96 * 0.95

      const result = client.testCalcPriceImpact(before, after, true);
      expect(result).toBeCloseTo(0.0975, 4);
    });

    it('should return squared impact, not linear (regression guard)', () => {
      // This is the core of the bug fix:
      // For sqrtRatio = 1.05, linear (old bug) would give 0.05
      // Squared (correct) gives 0.1025
      const before = EthersNumber.from('79228162514264337593543950336');
      const after = EthersNumber.from('83189570639977557991658356736');

      const result = client.testCalcPriceImpact(before, after, true);
      // Must NOT be ~0.05 (the old buggy value)
      expect(result).toBeGreaterThan(0.08);
      // Must be ~0.1025
      expect(result).toBeCloseTo(0.1025, 4);
    });

    it('should handle large price impacts', () => {
      // sqrtPriceAfter / sqrtPriceBefore = 1.5
      // priceRatio = 1.5^2 = 2.25
      // impact = |1 - 2.25| = 1.25
      const before = EthersNumber.from('79228162514264337593543950336');
      const after = EthersNumber.from('118842243771396506390315925504');  // 2^96 * 1.5

      const result = client.testCalcPriceImpact(before, after, true);
      expect(result).toBeCloseTo(1.25, 4);
    });
  });
});
