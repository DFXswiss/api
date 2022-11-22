import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { LiquidityOrder } from '../liquidity-order.entity';
import { createCustomLiquidityOrder, createDefaultLiquidityOrder } from '../__mocks__/liquidity-order.entity.mock';

describe('LiquidityOrder', () => {
  describe('#reserved(...)', () => {
    it('sets targetAmount to reference amount in case referenceAssets equals targetAsset, incomingAmount ignored', () => {
      const entity = createCustomLiquidityOrder({
        referenceAsset: createCustomAsset({ dexName: 'XYZ' }),
        targetAsset: createCustomAsset({ dexName: 'XYZ' }),
        referenceAmount: 50,
        targetAmount: undefined,
      });

      expect(entity.targetAmount).toBeUndefined();

      entity.reserved(100);

      expect(entity.targetAmount).toBe(50);
    });

    it('sets targetAmount to incomingAmount amount in case referenceAssets NOT equals targetAsset', () => {
      const entity = createCustomLiquidityOrder({
        referenceAsset: createCustomAsset({ dexName: 'XYZ' }),
        targetAsset: createCustomAsset({ dexName: 'ABC' }),
        referenceAmount: 50,
        targetAmount: undefined,
      });

      expect(entity.targetAmount).toBeUndefined();

      entity.reserved(100);

      expect(entity.targetAmount).toBe(100);
    });

    it('sets isReady to true', () => {
      const entity = createDefaultLiquidityOrder();

      expect(entity.isReady).toBe(false);

      entity.reserved(100);

      expect(entity.isReady).toBe(true);
    });
  });

  describe('#addBlockchainTransactionMetadata(...)', () => {
    it('sets txId, allows swap data to remain undefined', () => {
      const entity = createCustomLiquidityOrder({
        txId: undefined,
        swapAsset: undefined,
        swapAmount: undefined,
      });

      expect(entity.txId).toBeUndefined();
      expect(entity.swapAsset).toBeUndefined();
      expect(entity.swapAmount).toBeUndefined();

      entity.addBlockchainTransactionMetadata('PID_01');

      expect(entity.txId).toBe('PID_01');
      expect(entity.swapAsset).toBeUndefined();
      expect(entity.swapAmount).toBeUndefined();
    });

    it('sets swapAsset and swapAmount when provided', () => {
      const entity = createCustomLiquidityOrder({
        swapAsset: undefined,
        swapAmount: undefined,
      });

      expect(entity.swapAsset).toBeUndefined();
      expect(entity.swapAmount).toBeUndefined();

      entity.addBlockchainTransactionMetadata('PID_01', createCustomAsset({ dexName: 'DFI' }), 20);

      expect(entity.swapAsset.dexName).toBe('DFI');
      expect(entity.swapAmount).toBe(20);
    });
  });

  describe('#purchased(...)', () => {
    it('sets purchasedAmount', () => {
      const entity = createCustomLiquidityOrder({
        purchasedAmount: undefined,
      });

      expect(entity.purchasedAmount).toBeUndefined();

      entity.purchased(100);

      expect(entity.purchasedAmount).toBe(100);
    });

    it('sets targetAmount to reference amount in case referenceAssets equals targetAsset, incomingAmount ignored', () => {
      const entity = createCustomLiquidityOrder({
        referenceAsset: createCustomAsset({ dexName: 'XYZ' }),
        targetAsset: createCustomAsset({ dexName: 'XYZ' }),
        referenceAmount: 50,
        targetAmount: undefined,
      });

      expect(entity.targetAmount).toBeUndefined();

      entity.purchased(100);

      expect(entity.targetAmount).toBe(50);
    });

    it('sets targetAmount to incomingAmount amount in case referenceAssets NOT equals targetAsset', () => {
      const entity = createCustomLiquidityOrder({
        referenceAsset: createCustomAsset({ dexName: 'XYZ' }),
        targetAsset: createCustomAsset({ dexName: 'ABC' }),
        referenceAmount: 50,
        targetAmount: undefined,
      });

      expect(entity.targetAmount).toBeUndefined();

      entity.purchased(100);

      expect(entity.targetAmount).toBe(100);
    });

    it('sets isReady to true', () => {
      const entity = createDefaultLiquidityOrder();

      expect(entity.isReady).toBe(false);

      entity.purchased(100);

      expect(entity.isReady).toBe(true);
    });
  });

  describe('#complete(...)', () => {
    it('sets isComplete to true', () => {
      const entity = createDefaultLiquidityOrder();

      expect(entity.isComplete).toBe(false);

      entity.complete();

      expect(entity.isComplete).toBe(true);
    });
  });

  describe('static #getIsReferenceAsset(...)', () => {
    it('returns true if input asset is in BTC, USDC, USDT, ETH, BNB list', () => {
      expect(LiquidityOrder.getIsReferenceAsset('BTC')).toBe(true);
      expect(LiquidityOrder.getIsReferenceAsset('USDC')).toBe(true);
      expect(LiquidityOrder.getIsReferenceAsset('USDT')).toBe(true);
      expect(LiquidityOrder.getIsReferenceAsset('ETH')).toBe(true);
      expect(LiquidityOrder.getIsReferenceAsset('BNB')).toBe(true);
    });
    it('returns false if input asset is not in reference assets list list', () => {
      expect(LiquidityOrder.getIsReferenceAsset('DFI')).toBe(false);
      expect(LiquidityOrder.getIsReferenceAsset('GOOGL')).toBe(false);
    });
  });

  describe('static #getMaxPriceSlippage(...)', () => {
    it('returns 0.005 if input asset is in BTC, USDC, USDT, ETH, BNB list', () => {
      expect(LiquidityOrder.getMaxPriceSlippage('BTC')).toBe(0.005);
      expect(LiquidityOrder.getMaxPriceSlippage('USDC')).toBe(0.005);
      expect(LiquidityOrder.getMaxPriceSlippage('USDT')).toBe(0.005);
      expect(LiquidityOrder.getMaxPriceSlippage('ETH')).toBe(0.005);
      expect(LiquidityOrder.getMaxPriceSlippage('BNB')).toBe(0.005);
    });
    it('returns 0.03 if input asset is not in reference assets list list', () => {
      expect(LiquidityOrder.getMaxPriceSlippage('DFI')).toBe(0.03);
      expect(LiquidityOrder.getMaxPriceSlippage('GOOGL')).toBe(0.03);
    });
  });
});
