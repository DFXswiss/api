import { ScryptOrderSide } from '../../dto/scrypt.dto';
import { ScryptService } from '../scrypt.service';

describe('ScryptService.applyPriceCap', () => {
  const orderbook = 66_500;

  describe('priceCap unset / invalid', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['zero', 0],
      ['negative', -100],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
    ])('returns orderbookPrice when priceCap is %s', (_label, cap) => {
      expect(ScryptService.applyPriceCap(orderbook, ScryptOrderSide.BUY, cap as number | undefined)).toBe(orderbook);
      expect(ScryptService.applyPriceCap(orderbook, ScryptOrderSide.SELL, cap as number | undefined)).toBe(orderbook);
    });
  });

  describe('side=BUY (cap = upper bound)', () => {
    it('uses orderbook price when below cap (cheaper market)', () => {
      expect(ScryptService.applyPriceCap(66_500, ScryptOrderSide.BUY, 66_700)).toBe(66_500);
    });

    it('uses cap when orderbook is above cap (clamp)', () => {
      expect(ScryptService.applyPriceCap(66_900, ScryptOrderSide.BUY, 66_700)).toBe(66_700);
    });

    it('returns either when equal', () => {
      expect(ScryptService.applyPriceCap(66_700, ScryptOrderSide.BUY, 66_700)).toBe(66_700);
    });
  });

  describe('side=SELL (cap = lower bound)', () => {
    it('uses orderbook price when above cap (better market)', () => {
      expect(ScryptService.applyPriceCap(66_500, ScryptOrderSide.SELL, 66_300)).toBe(66_500);
    });

    it('uses cap when orderbook is below cap (clamp)', () => {
      expect(ScryptService.applyPriceCap(66_100, ScryptOrderSide.SELL, 66_300)).toBe(66_300);
    });

    it('returns either when equal', () => {
      expect(ScryptService.applyPriceCap(66_300, ScryptOrderSide.SELL, 66_300)).toBe(66_300);
    });
  });
});
