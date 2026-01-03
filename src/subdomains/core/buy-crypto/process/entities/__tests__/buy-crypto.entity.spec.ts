import { Test } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import { LiquidityManagementPipelineStatus } from 'src/subdomains/core/liquidity-management/enums';
import { Price, PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { createCustomBuyCrypto, createDefaultBuyCrypto } from '../__mocks__/buy-crypto.entity.mock';
import { BuyCrypto } from '../buy-crypto.entity';

function createPrice(source: string, target: string, price?: number): Price {
  return Object.assign(new Price(), { source, target, price, steps: [] });
}

function createPipelineMock(status: LiquidityManagementPipelineStatus, orders?: any[]): any {
  return {
    status,
    orders: orders ?? [],
  };
}

function createPipelineOrderMock(inputAmount: number, outputAmount: number, system = 'Binance'): any {
  return {
    inputAmount,
    outputAmount,
    inputAsset: 'USDT',
    outputAsset: 'BTC',
    action: { system },
    get exchangePrice(): Price {
      const price = inputAmount / outputAmount;
      return Price.create('USDT', 'BTC', price);
    },
  };
}

beforeEach(async () => {
  await Test.createTestingModule({
    providers: [TestUtil.provideConfig()],
  }).compile();
});

describe('BuyCrypto', () => {
  describe('#calculateOutputReferenceAmount(...)', () => {
    it('throws an error if input price is zero', () => {
      const entity = createDefaultBuyCrypto();
      const wrongPrice = createPrice('EUR', 'BTC', 0);

      const testCall = () => entity.calculateOutputReferenceAmount(wrongPrice);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Cannot calculate target amount, price value is 0');
    });

    it('calculates outputReferenceAmount given a valid price', () => {
      const entity = createCustomBuyCrypto({ inputReferenceAmountMinusFee: 10, outputReferenceAmount: undefined });
      const price = createPrice('EUR', 'BTC', 2);

      expect(entity.outputReferenceAmount).toBeUndefined();

      entity.calculateOutputReferenceAmount(price);

      expect(entity.outputReferenceAmount).toBe(5);
    });

    it('calculates outputReferenceAmount for a given price', () => {
      const entity = createCustomBuyCrypto({
        inputReferenceAsset: 'BTC',
        inputReferenceAmountMinusFee: 10,
        outputReferenceAmount: undefined,
      });

      expect(entity.outputReferenceAmount).toBeUndefined();

      entity.calculateOutputReferenceAmount(Price.create('BTC', 'ANY', 1));

      expect(entity.outputReferenceAmount).toBe(10);
    });

    it('rounds outputReferenceAmount to 8 digits after decimal', () => {
      const entity = createCustomBuyCrypto({ inputReferenceAmountMinusFee: 1, outputReferenceAmount: undefined });
      const price = createPrice('EUR', 'BTC', 3);

      expect(entity.outputReferenceAmount).toBeUndefined();

      entity.calculateOutputReferenceAmount(price);

      expect(entity.outputReferenceAmount).toBe(0.33333333);
    });

    it('returns instance of BuyCrypto', () => {
      const entity = createCustomBuyCrypto({ inputReferenceAmountMinusFee: 10 });
      const price = createPrice('EUR', 'BTC', 2);

      const updatedEntity = entity.calculateOutputReferenceAmount(price);

      expect(updatedEntity).toBeInstanceOf(BuyCrypto);
    });

    describe('with liquidityPipeline', () => {
      beforeEach(async () => {
        // Enable pipeline price feature for these tests
        await Test.createTestingModule({
          providers: [
            TestUtil.provideConfig({
              liquidityManagement: {
                usePipelinePriceForAllAssets: true,
                bankMinBalance: 100,
                fiatOutput: { batchAmountLimit: 9500 },
              },
            }),
          ],
        }).compile();
      });

      it('uses pipeline price when pipeline is COMPLETE with exchange orders', () => {
        // Pipeline bought 1 BTC for 50000 USDT (price = 50000)
        const pipelineOrder = createPipelineOrderMock(50000, 1);
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, [pipelineOrder]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 50000,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        // Market price is 60000 (different from pipeline price)
        const marketPrice = Price.create('USDT', 'BTC', 60000);

        entity.calculateOutputReferenceAmount(marketPrice, [pipelineOrder]);

        // Should use pipeline price (50000), not market price (60000)
        // 50000 USDT / 50000 price = 1 BTC
        expect(entity.outputReferenceAmount).toBe(1);
      });

      it('uses market price when no pipeline exists', () => {
        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 50000,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: undefined,
        });

        // Market price is 60000
        const marketPrice = Price.create('USDT', 'BTC', 60000);

        entity.calculateOutputReferenceAmount(marketPrice);

        // Should use market price: 50000 / 60000 = 0.83333333
        expect(entity.outputReferenceAmount).toBe(0.83333333);
      });

      it('uses market price when pipeline status is FAILED', () => {
        const pipelineOrder = createPipelineOrderMock(50000, 1);
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.FAILED, [pipelineOrder]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 50000,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        const marketPrice = Price.create('USDT', 'BTC', 60000);

        entity.calculateOutputReferenceAmount(marketPrice);

        // Should use market price because pipeline FAILED
        expect(entity.outputReferenceAmount).toBe(0.83333333);
      });

      it('uses market price when pipeline status is STOPPED', () => {
        const pipelineOrder = createPipelineOrderMock(50000, 1);
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.STOPPED, [pipelineOrder]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 50000,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        const marketPrice = Price.create('USDT', 'BTC', 60000);

        entity.calculateOutputReferenceAmount(marketPrice);

        // Should use market price because pipeline STOPPED
        expect(entity.outputReferenceAmount).toBe(0.83333333);
      });

      it('throws error when pipeline is IN_PROGRESS', () => {
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.IN_PROGRESS, []);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 50000,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        const marketPrice = Price.create('USDT', 'BTC', 60000);

        expect(() => entity.calculateOutputReferenceAmount(marketPrice)).toThrow('LiquidityPipeline not completed');
      });

      it('throws error when pipeline is CREATED', () => {
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.CREATED, []);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 50000,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        const marketPrice = Price.create('USDT', 'BTC', 60000);

        expect(() => entity.calculateOutputReferenceAmount(marketPrice)).toThrow('LiquidityPipeline not completed');
      });

      it('uses market price when pipeline is COMPLETE but no exchange order (no trade happened)', () => {
        // Scenario: Pipeline completed but no trade was needed (enough liquidity available)
        // In this case, use market price since no actual exchange happened
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, []);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 50000,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        const marketPrice = Price.create('USDT', 'BTC', 60000);

        entity.calculateOutputReferenceAmount(marketPrice);

        // Should use market price: 50000 / 60000 = 0.83333333
        expect(entity.outputReferenceAmount).toBe(0.83333333);
      });

      it('protects against price drop during transfer - customer gets correct amount based on purchase price', () => {
        // Scenario: DFX buys BTC at 50000, price drops to 40000 during transfer
        // Customer paid 50000 USDT, should get 1 BTC (not 1.25 BTC at new price)
        const pipelineOrder = createPipelineOrderMock(50000, 1);
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, [pipelineOrder]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 50000,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        // Market price dropped to 40000 during transfer
        const marketPrice = Price.create('USDT', 'BTC', 40000);

        entity.calculateOutputReferenceAmount(marketPrice, [pipelineOrder]);

        // Should use pipeline price (50000), customer gets 1 BTC
        // NOT 1.25 BTC (which would be 50000/40000 at market price)
        expect(entity.outputReferenceAmount).toBe(1);
      });

      it('protects against price rise during transfer - customer gets correct amount based on purchase price', () => {
        // Scenario: DFX buys BTC at 50000, price rises to 60000 during transfer
        // Customer paid 50000 USDT, should get 1 BTC (not 0.833 BTC at new price)
        const pipelineOrder = createPipelineOrderMock(50000, 1);
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, [pipelineOrder]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 50000,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        // Market price rose to 60000 during transfer
        const marketPrice = Price.create('USDT', 'BTC', 60000);

        entity.calculateOutputReferenceAmount(marketPrice, [pipelineOrder]);

        // Should use pipeline price (50000), customer gets 1 BTC
        // NOT 0.83333333 BTC (which would be 50000/60000 at market price)
        expect(entity.outputReferenceAmount).toBe(1);
      });

      it('aggregates multiple orders with same asset pair', () => {
        // Two orders for the same asset pair - should aggregate amounts
        const pipelineOrder1 = createPipelineOrderMock(50000, 1); // 50000 USDT -> 1 BTC
        const pipelineOrder2 = createPipelineOrderMock(60000, 1); // 60000 USDT -> 1 BTC
        // Combined: 110000 USDT -> 2 BTC, price = 55000

        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, [
          pipelineOrder1,
          pipelineOrder2,
        ]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 55000,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        const marketPrice = Price.create('USDT', 'BTC', 70000);

        entity.calculateOutputReferenceAmount(marketPrice, [pipelineOrder1, pipelineOrder2]);

        // Should use aggregated pipeline price (55000): 55000 / 55000 = 1 BTC
        expect(entity.outputReferenceAmount).toBe(1);
      });

      it('handles small amounts correctly with pipeline price', () => {
        // Customer buying small amount: 100 USDT worth of BTC
        const pipelineOrder = createPipelineOrderMock(100000, 2); // DFX bought 2 BTC for 100000 USDT (price = 50000)
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, [pipelineOrder]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 100,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        const marketPrice = Price.create('USDT', 'BTC', 60000);

        entity.calculateOutputReferenceAmount(marketPrice, [pipelineOrder]);

        // Should use pipeline price (50000): 100 / 50000 = 0.002 BTC
        expect(entity.outputReferenceAmount).toBe(0.002);
      });

      it('handles partial fill scenario - customer amount less than pipeline purchase', () => {
        // DFX bought 2 BTC for 100000 USDT (for multiple customers)
        // This customer only wants 0.5 BTC worth
        const pipelineOrder = createPipelineOrderMock(100000, 2); // price = 50000
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, [pipelineOrder]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 25000, // Customer wants 0.5 BTC worth
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        const marketPrice = Price.create('USDT', 'BTC', 60000);

        entity.calculateOutputReferenceAmount(marketPrice, [pipelineOrder]);

        // Should use pipeline price (50000): 25000 / 50000 = 0.5 BTC
        expect(entity.outputReferenceAmount).toBe(0.5);
      });

      it('works with FPS using FRANKENCOIN system', () => {
        // FPS purchase: ZCHF → FPS via Frankencoin contract
        const pipelineOrder = {
          inputAmount: 1000,
          outputAmount: 10, // 1000 ZCHF → 10 FPS (price = 100 ZCHF/FPS)
          inputAsset: 'ZCHF',
          outputAsset: 'FPS',
          action: { system: 'Frankencoin' },
        };
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, [pipelineOrder]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 500,
          inputReferenceAsset: 'ZCHF',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        // Market price is 120 ZCHF/FPS (different from pipeline)
        const marketPrice = Price.create('ZCHF', 'FPS', 120);

        entity.calculateOutputReferenceAmount(marketPrice, [pipelineOrder] as any);

        // Should use pipeline price (100): 500 / 100 = 5 FPS
        expect(entity.outputReferenceAmount).toBe(5);
      });

      it('works with nDEPS using DEURO system', () => {
        // nDEPS purchase: dEURO → nDEPS via dEURO contract
        const pipelineOrder = {
          inputAmount: 2000,
          outputAmount: 20, // 2000 dEURO → 20 nDEPS (price = 100 dEURO/nDEPS)
          inputAsset: 'dEURO',
          outputAsset: 'nDEPS',
          action: { system: 'dEURO' },
        };
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, [pipelineOrder]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 1000,
          inputReferenceAsset: 'dEURO',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        // Market price is 150 dEURO/nDEPS (different from pipeline)
        const marketPrice = Price.create('dEURO', 'nDEPS', 150);

        entity.calculateOutputReferenceAmount(marketPrice, [pipelineOrder] as any);

        // Should use pipeline price (100): 1000 / 100 = 10 nDEPS
        expect(entity.outputReferenceAmount).toBe(10);
      });

      it('handles multi-step conversion EUR → USDT → BTC with pipeline prices', () => {
        // Two-step conversion: EUR → USDT (Kraken) → BTC (Binance)
        const eurUsdtOrder = {
          inputAmount: 10000,
          outputAmount: 10400, // 10000 EUR → 10400 USDT (price = 0.9615 EUR/USDT)
          inputAsset: 'EUR',
          outputAsset: 'USDT',
          action: { system: 'Kraken' },
        };
        const usdtBtcOrder = {
          inputAmount: 104000,
          outputAmount: 2, // 104000 USDT → 2 BTC (price = 52000 USDT/BTC)
          inputAsset: 'USDT',
          outputAsset: 'BTC',
          action: { system: 'Binance' },
        };
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, [eurUsdtOrder, usdtBtcOrder]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 1000,
          inputReferenceAsset: 'EUR',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        // Market price with steps (different from pipeline)
        const marketPrice = Object.assign(new Price(), {
          source: 'EUR',
          target: 'BTC',
          price: 55000, // 1 EUR = 1.1 USDT * 50000 USDT/BTC = 55000 EUR/BTC
          steps: [
            PriceStep.create('CoinGecko', 'EUR', 'USDT', 1.1), // Market: 1 EUR = 1.1 USDT
            PriceStep.create('CoinGecko', 'USDT', 'BTC', 50000), // Market: 50000 USDT/BTC
          ],
        });

        entity.calculateOutputReferenceAmount(marketPrice, [eurUsdtOrder, usdtBtcOrder] as any);

        // Pipeline prices: EUR/USDT = 0.9615, USDT/BTC = 52000
        // Total: 0.9615 * 52000 = 49998 EUR/BTC (approximately 50000)
        // 1000 EUR / 50000 = 0.02 BTC
        // Note: Actual calculation uses aggregated amounts:
        // EUR→USDT: 10000/10400 = 0.9615 (inverted, so 1.04 USDT per EUR)
        // Wait, price = inputAmount/outputAmount = 10000/10400 = 0.9615
        // USDT→BTC: 104000/2 = 52000
        // Total = 0.9615 * 52000 = 49998
        // 1000 / 49998 ≈ 0.02 BTC
        expect(entity.outputReferenceAmount).toBeCloseTo(0.02, 4);
      });

      it('replaces only matching steps - keeps CoinGecko for unmatched', () => {
        // Pipeline only has USDT → BTC, not EUR → USDT
        const usdtBtcOrder = {
          inputAmount: 50000,
          outputAmount: 1, // 50000 USDT → 1 BTC
          inputAsset: 'USDT',
          outputAsset: 'BTC',
          action: { system: 'Binance' },
        };
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, [usdtBtcOrder]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 1000,
          inputReferenceAsset: 'EUR',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        // Market price with steps
        const marketPrice = Object.assign(new Price(), {
          source: 'EUR',
          target: 'BTC',
          price: 55000,
          steps: [
            PriceStep.create('CoinGecko', 'EUR', 'USDT', 1.1), // No pipeline match - keep CoinGecko
            PriceStep.create('CoinGecko', 'USDT', 'BTC', 50000), // Pipeline match - replace
          ],
        });

        entity.calculateOutputReferenceAmount(marketPrice, [usdtBtcOrder] as any);

        // EUR → USDT: CoinGecko 1.1
        // USDT → BTC: Pipeline 50000
        // Total = 1.1 * 50000 = 55000
        // 1000 / 55000 = 0.01818...
        expect(entity.outputReferenceAmount).toBeCloseTo(0.01818, 4);
      });
    });
  });

  describe('#calculateOutputAmount(...)', () => {
    it('throws an error if input batchReferenceAmount is zero', () => {
      const entity = createDefaultBuyCrypto();

      const testCall = () => entity.setOutputAmount(0, 5);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Cannot calculate outputAmount, provided batchReferenceAmount is 0');
    });

    it('calculates outputAmount in proportion to batch amounts', () => {
      const entity = createCustomBuyCrypto({ outputReferenceAmount: 10, outputAmount: undefined });

      expect(entity.outputAmount).toBe(undefined);

      entity.setOutputAmount(50, 100);

      expect(entity.outputAmount).toBe(20);
    });

    it('rounds outputAmount to 8 digits after decimal', () => {
      const entity = createCustomBuyCrypto({ outputReferenceAmount: 1, outputAmount: undefined });

      expect(entity.outputAmount).toBe(undefined);

      entity.setOutputAmount(3, 10);

      expect(entity.outputAmount).toBe(3.33333333);
    });

    it('returns instance of BuyCrypto', () => {
      const entity = createCustomBuyCrypto({ outputReferenceAmount: 1 });

      const updatedEntity = entity.setOutputAmount(3, 10);

      expect(updatedEntity).toBeInstanceOf(BuyCrypto);
    });
  });

  describe('#complete(...)', () => {
    it('sets isComplete to true', () => {
      const entity = createCustomBuyCrypto({ isComplete: undefined });

      expect(entity.isComplete).toBe(undefined);

      entity.complete(0);

      expect(entity.isComplete).toBe(true);
    });

    it('adds txId to the entity', () => {
      const entity = createCustomBuyCrypto({ txId: undefined });

      expect(entity.txId).toBe(undefined);

      entity.setTxId('TX_ID_01');

      expect(entity.txId).toBe('TX_ID_01');
    });

    it('adds outputDate to the entity', () => {
      const entity = createCustomBuyCrypto({ outputDate: undefined });

      expect(entity.outputDate).toBe(undefined);

      entity.complete(0);

      expect(entity.outputDate).toBeInstanceOf(Date);
    });
  });

  describe('#confirmSentMail(...)', () => {
    it('adds user recipientMail to the entity', () => {
      const entity = createCustomBuyCrypto({ recipientMail: undefined });

      expect(entity.recipientMail).toBe(undefined);

      entity.confirmSentMail();

      expect(entity.recipientMail).toBe('test@test.com');
    });

    it('sets mailSendDate to the timestamp', () => {
      const entity = createCustomBuyCrypto({ mailSendDate: undefined });

      expect(entity.mailSendDate).toBe(undefined);

      entity.confirmSentMail();

      expect(entity.mailSendDate).toBeTruthy();
      expect(entity.mailSendDate).toBeInstanceOf(Date);
    });

    it('returns instance of BuyCrypto', () => {
      const entity = createDefaultBuyCrypto();

      const updatedEntity = entity.confirmSentMail();

      expect(updatedEntity).toBeInstanceOf(Array);
    });
  });
});
