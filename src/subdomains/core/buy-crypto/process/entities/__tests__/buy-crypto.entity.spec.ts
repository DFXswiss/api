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

function createPipelineOrderMock(inputAmount: number, outputAmount: number): any {
  return {
    inputAmount,
    outputAmount,
    inputAsset: 'USDT',
    outputAsset: 'BTC',
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
      it('uses pipeline price when pipeline is COMPLETE with exchange order', () => {
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

        entity.calculateOutputReferenceAmount(marketPrice, pipelineOrder);

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

        entity.calculateOutputReferenceAmount(marketPrice, pipelineOrder);

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

        entity.calculateOutputReferenceAmount(marketPrice, pipelineOrder);

        // Should use pipeline price (50000), customer gets 1 BTC
        // NOT 0.83333333 BTC (which would be 50000/60000 at market price)
        expect(entity.outputReferenceAmount).toBe(1);
      });

      it('uses the provided exchange order', () => {
        // The exchange order is passed explicitly - uses that order's price
        const pipelineOrder1 = createPipelineOrderMock(50000, 1); // price = 50000
        const pipelineOrder2 = createPipelineOrderMock(60000, 1); // price = 60000
        const pipeline = createPipelineMock(LiquidityManagementPipelineStatus.COMPLETE, [
          pipelineOrder1,
          pipelineOrder2,
        ]);

        const entity = createCustomBuyCrypto({
          inputReferenceAmountMinusFee: 50000,
          inputReferenceAsset: 'USDT',
          outputReferenceAmount: undefined,
          liquidityPipeline: pipeline,
        });

        const marketPrice = Price.create('USDT', 'BTC', 55000);

        // Explicitly pass pipelineOrder1 as the exchange order
        entity.calculateOutputReferenceAmount(marketPrice, pipelineOrder1);

        // Should use the provided exchange order's price (50000)
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

        entity.calculateOutputReferenceAmount(marketPrice, pipelineOrder);

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

        entity.calculateOutputReferenceAmount(marketPrice, pipelineOrder);

        // Should use pipeline price (50000): 25000 / 50000 = 0.5 BTC
        expect(entity.outputReferenceAmount).toBe(0.5);
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
