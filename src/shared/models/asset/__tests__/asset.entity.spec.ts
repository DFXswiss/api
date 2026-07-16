import { createCustomAsset } from '../__mocks__/asset.entity.mock';
import { Asset } from '../asset.entity';

describe('Asset', () => {
  describe('#isSanePrice', () => {
    it('accepts regular prices', () => {
      expect(Asset.isSanePrice(0.0061)).toBe(true);
      expect(Asset.isSanePrice(1)).toBe(true);
      expect(Asset.isSanePrice(100000)).toBe(true);
    });

    it('rejects unset, zero, non-finite and degenerate prices', () => {
      expect(Asset.isSanePrice(undefined)).toBe(false);
      expect(Asset.isSanePrice(0)).toBe(false);
      expect(Asset.isSanePrice(NaN)).toBe(false);
      expect(Asset.isSanePrice(Infinity)).toBe(false);
      expect(Asset.isSanePrice(4.2421310463457016e-60)).toBe(false);
      expect(Asset.isSanePrice(1e60)).toBe(false);
    });
  });

  describe('#minimalPriceReferenceAmount', () => {
    it('returns the inverse of a sane approxPriceChf', () => {
      const asset = createCustomAsset({ approxPriceChf: 0.5 });

      expect(asset.minimalPriceReferenceAmount).toBe(2);
    });

    it('falls back to 1 when approxPriceChf is unset', () => {
      const asset = createCustomAsset({ approxPriceChf: undefined });

      expect(asset.minimalPriceReferenceAmount).toBe(1);
    });

    it('falls back to 1 when approxPriceChf is 0', () => {
      const asset = createCustomAsset({ approxPriceChf: 0 });

      expect(asset.minimalPriceReferenceAmount).toBe(1);
    });

    it('falls back to 1 for a degenerate near-zero price instead of inverting it into an overflow', () => {
      const asset = createCustomAsset({ approxPriceChf: 4.2421310463457016e-60 });

      expect(asset.minimalPriceReferenceAmount).toBe(1);
    });
  });
});
