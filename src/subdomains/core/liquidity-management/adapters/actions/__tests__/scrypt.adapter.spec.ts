import { ScryptOrderSide } from 'src/integration/exchange/dto/scrypt.dto';
import { ScryptAdapter } from '../scrypt.adapter';

describe('ScryptAdapter.toPriceCap', () => {
  const maxDev = 0.003;

  // Anchor: at 2026-05-21 ~13:44 UTC, Kraken VWAP BTC/EUR was ~66'218 EUR/BTC.
  // The pricingService convention is Price.price = source/target (= from/to),
  // verified via Price.convert(amount) = amount/price.
  // Scrypt LIMIT orders express price as quote-per-base, so:
  //   pricingService.getPrice(EUR, BTC).price = EUR-per-BTC (high number, e.g. 66_500)
  //   pricingService.getPrice(BTC, EUR).price = BTC-per-EUR (small number, e.g. 1.5e-5)

  describe('side=BUY (e.g. sellIfDeficit BTC: from=EUR=quote, to=BTC=base)', () => {
    it('treats from-per-to reference directly as quote-per-base and returns upper bound', () => {
      // ref 66'500 EUR/BTC → cap = 66'500 × 1.003 = 66'699.5
      expect(ScryptAdapter.toPriceCap(66_500, ScryptOrderSide.BUY, maxDev)).toBeCloseTo(66_699.5, 4);
    });

    it('cap is strictly greater than reference for BUY', () => {
      const cap = ScryptAdapter.toPriceCap(66_500, ScryptOrderSide.BUY, maxDev);
      expect(cap).toBeGreaterThan(66_500);
    });
  });

  describe('side=SELL (e.g. selling BTC for EUR: from=BTC=base, to=EUR=quote)', () => {
    it('inverts from-per-to reference into quote-per-base and returns lower bound', () => {
      // ref 1.5e-5 BTC/EUR  →  refQuotePerBase = 1 / 1.5e-5 = 66_666.67  →  cap = ×0.997 = 66'466.67
      expect(ScryptAdapter.toPriceCap(1.5e-5, ScryptOrderSide.SELL, maxDev)).toBeCloseTo(66_466.67, 1);
    });

    it('cap is strictly less than the inverted reference for SELL', () => {
      const ref = 1.5e-5;
      const cap = ScryptAdapter.toPriceCap(ref, ScryptOrderSide.SELL, maxDev);
      expect(cap).toBeLessThan(1 / ref);
    });
  });

  describe('symmetry sanity', () => {
    it('BUY cap on (EUR, BTC) ≈ inverse of SELL cap on (BTC, EUR) within 1.6× the deviation window', () => {
      // Refs are exact inverses of each other (66_500 ↔ 1/66_500)
      const buyRef = 66_500;
      const sellRef = 1 / buyRef;

      const buyCap = ScryptAdapter.toPriceCap(buyRef, ScryptOrderSide.BUY, maxDev); // 66_500 × 1.003
      const sellCap = ScryptAdapter.toPriceCap(sellRef, ScryptOrderSide.SELL, maxDev); // 66_500 × 0.997

      // Both caps are in EUR/BTC (quote-per-base). They differ by 2×maxDev around the mid.
      const ratio = buyCap / sellCap;
      expect(ratio).toBeCloseTo((1 + maxDev) / (1 - maxDev), 5);
    });
  });
});
