import { createCustomAsset } from './__mocks__/asset.entity.mock';

describe('Asset', () => {
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

    it('falls back to 1 when approxPriceChf is a degenerate near-zero value', () => {
      // e.g. from a degenerate on-chain DEX quote (observed: 4.24e-60), which would
      // otherwise invert into a reference amount that overflows on-chain swap math
      const asset = createCustomAsset({ approxPriceChf: 4.2421310463457016e-60 });

      expect(asset.minimalPriceReferenceAmount).toBe(1);
    });
  });
});
