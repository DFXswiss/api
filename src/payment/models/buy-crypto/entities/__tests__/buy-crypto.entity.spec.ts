import { createCustomBuy } from 'src/payment/models/buy/__tests__/mock/buy.entity.mock';
import { Price } from 'src/payment/models/exchange/dto/price.dto';
import { createCustomAsset } from 'src/shared/models/asset/__tests__/mock/asset.entity.mock';
import { BuyCrypto } from '../buy-crypto.entity';
import { createCustomBuyCrypto, createDefaultBuyCrypto } from './mock/buy-crypto.entity.mock';

describe('BuyCrypto', () => {
  describe('#defineAssetExchangePair(...)', () => {
    it('assigns outputReferenceAsset to BTC, when outputAsset is BTC', () => {
      const entity = createCustomBuyCrypto({
        outputReferenceAsset: undefined,
        buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'BTC' }) }),
      });

      expect(entity.outputReferenceAsset).toBeUndefined();

      entity.defineAssetExchangePair();

      expect(entity.outputReferenceAsset).toBe('BTC');
    });

    it('assigns outputReferenceAsset to USDC, when outputAsset is USDC', () => {
      const entity = createCustomBuyCrypto({
        outputReferenceAsset: undefined,
        buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'USDC' }) }),
      });

      expect(entity.outputReferenceAsset).toBeUndefined();

      entity.defineAssetExchangePair();

      expect(entity.outputReferenceAsset).toBe('USDC');
    });

    it('assigns outputReferenceAsset to USDT, when outputAsset is USDT', () => {
      const entity = createCustomBuyCrypto({
        outputReferenceAsset: undefined,
        buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'USDT' }) }),
      });

      expect(entity.outputReferenceAsset).toBeUndefined();

      entity.defineAssetExchangePair();

      expect(entity.outputReferenceAsset).toBe('USDT');
    });

    it('assigns outputReferenceAsset to BTC, when outputAsset is not BTC, USDC or USDT', () => {
      const entity = createCustomBuyCrypto({
        outputReferenceAsset: undefined,
        buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'GOOGL' }) }),
      });

      expect(entity.outputReferenceAsset).toBeUndefined();

      entity.defineAssetExchangePair();

      expect(entity.outputReferenceAsset).toBe('BTC');
    });

    it('returns instance of BuyCrypto', () => {
      const entity = createDefaultBuyCrypto();

      const updatedEntity = entity.defineAssetExchangePair();

      expect(updatedEntity).toBeInstanceOf(BuyCrypto);
    });
  });

  describe('#calculateOutputReferenceAmount(...)', () => {
    it('throws an error if input pricePair does not contain EUR', () => {
      const entity = createDefaultBuyCrypto();
      const wrongPrice = new Price();
      wrongPrice.currencyPair = 'CHF/BTC';

      const testCall = () => entity.calculateOutputReferenceAmount([wrongPrice]);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Cannot calculate outputReferenceAmount, EUR/BTC price is missing');
    });
    it('throws an error if input pricePair does not contain BTC', () => {
      const entity = createDefaultBuyCrypto();
      const wrongPrice = new Price();
      wrongPrice.currencyPair = 'EUR/ETH';

      const testCall = () => entity.calculateOutputReferenceAmount([wrongPrice]);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Cannot calculate outputReferenceAmount, EUR/BTC price is missing');
    });

    it('throws an error if input price is zero', () => {
      const entity = createDefaultBuyCrypto();
      const wrongPrice = new Price();
      wrongPrice.currencyPair = 'EUR/BTC';
      wrongPrice.price = 0;

      const testCall = () => entity.calculateOutputReferenceAmount([wrongPrice]);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Cannot calculate outputReferenceAmount, price value is 0');
    });

    it('calculates outputReferenceAmount given a valid price', () => {
      const entity = createCustomBuyCrypto({ inputReferenceAmountMinusFee: 10, outputReferenceAmount: undefined });
      const price = new Price();
      price.currencyPair = 'EUR/BTC';
      price.price = 2;

      expect(entity.outputReferenceAmount).toBeUndefined();

      entity.calculateOutputReferenceAmount([price]);

      expect(entity.outputReferenceAmount).toBe(5);
    });

    it('calculates outputReferenceAmount given input and output asset are the same', () => {
      const entity = createCustomBuyCrypto({
        inputReferenceAsset: 'BTC',
        inputReferenceAmountMinusFee: 10,
        outputReferenceAmount: undefined,
      });

      expect(entity.outputReferenceAmount).toBeUndefined();

      entity.calculateOutputReferenceAmount([]);

      expect(entity.outputReferenceAmount).toBe(10);
    });

    it('rounds outputReferenceAmount to 8 digits after decimal', () => {
      const entity = createCustomBuyCrypto({ inputReferenceAmountMinusFee: 1, outputReferenceAmount: undefined });
      const price = new Price();
      price.currencyPair = 'EUR/BTC';
      price.price = 3;

      expect(entity.outputReferenceAmount).toBeUndefined();

      entity.calculateOutputReferenceAmount([price]);

      expect(entity.outputReferenceAmount).toBe(0.33333333);
    });

    it('returns instance of BuyCrypto', () => {
      const entity = createCustomBuyCrypto({ inputReferenceAmountMinusFee: 10 });
      const price = new Price();
      price.currencyPair = 'EUR/BTC';
      price.price = 2;

      const updatedEntity = entity.calculateOutputReferenceAmount([price]);

      expect(updatedEntity).toBeInstanceOf(BuyCrypto);
    });
  });

  describe('#calculateOutputAmount(...)', () => {
    it('throws an error if input batchReferenceAmount is zero', () => {
      const entity = createDefaultBuyCrypto();

      const testCall = () => entity.calculateOutputAmount(0, 5);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Cannot calculate outputAmount, provided batchReferenceAmount is 0');
    });

    it('calculates outputAmount in proportion to batch amounts', () => {
      const entity = createCustomBuyCrypto({ outputReferenceAmount: 10, outputAmount: undefined });

      expect(entity.outputAmount).toBe(undefined);

      entity.calculateOutputAmount(50, 100);

      expect(entity.outputAmount).toBe(20);
    });

    it('rounds outputAmount to 8 digits after decimal', () => {
      const entity = createCustomBuyCrypto({ outputReferenceAmount: 1, outputAmount: undefined });

      expect(entity.outputAmount).toBe(undefined);

      entity.calculateOutputAmount(3, 10);

      expect(entity.outputAmount).toBe(3.33333333);
    });

    it('returns instance of BuyCrypto', () => {
      const entity = createCustomBuyCrypto({ outputReferenceAmount: 1 });

      const updatedEntity = entity.calculateOutputAmount(3, 10);

      expect(updatedEntity).toBeInstanceOf(BuyCrypto);
    });
  });

  describe('#recordTransactionPayout(...)', () => {
    it('adds txId to the entity', () => {
      const entity = createCustomBuyCrypto({ txId: undefined });

      expect(entity.txId).toBe(undefined);

      entity.recordTransactionPayout('TX_ID_01');

      expect(entity.txId).toBe('TX_ID_01');
    });

    it('adds outputDate to the entity', () => {
      const entity = createCustomBuyCrypto({ outputDate: undefined });

      expect(entity.outputDate).toBe(undefined);

      entity.recordTransactionPayout('TX_ID_01');

      expect(entity.outputDate).toBeTruthy();
      expect(entity.outputDate).toBeInstanceOf(Date);
    });

    it('returns instance of BuyCrypto', () => {
      const entity = createDefaultBuyCrypto();

      const updatedEntity = entity.recordTransactionPayout('TX_ID_01');

      expect(updatedEntity).toBeInstanceOf(BuyCrypto);
    });
  });

  describe('#complete(...)', () => {
    it('sets isComplete to true', () => {
      const entity = createCustomBuyCrypto({ isComplete: undefined });

      expect(entity.isComplete).toBe(undefined);

      entity.complete();

      expect(entity.isComplete).toBe(true);
    });

    it('returns instance of BuyCrypto', () => {
      const entity = createDefaultBuyCrypto();

      const updatedEntity = entity.complete();

      expect(updatedEntity).toBeInstanceOf(BuyCrypto);
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
      expect(typeof entity.mailSendDate).toBe('number');
    });

    it('returns instance of BuyCrypto', () => {
      const entity = createDefaultBuyCrypto();

      const updatedEntity = entity.confirmSentMail();

      expect(updatedEntity).toBeInstanceOf(BuyCrypto);
    });
  });
});
