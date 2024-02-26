import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { createCustomBuy } from 'src/subdomains/core/buy-crypto/routes/buy/__mocks__/buy.entity.mock';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { createCustomBuyCrypto, createDefaultBuyCrypto } from '../__mocks__/buy-crypto.entity.mock';
import { BuyCrypto } from '../buy-crypto.entity';

function createPrice(source: string, target: string, price?: number): Price {
  return Object.assign(new Price(), { source, target, price });
}

describe('BuyCrypto', () => {
  describe('#defineAssetExchangePair(...)', () => {
    it('assigns outputAsset to target asset', () => {
      const entity = createCustomBuyCrypto({
        outputAsset: undefined,
        buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'GOOGL' }) }),
      });

      expect(entity.outputAsset).toBeUndefined();

      entity.defineAssetExchangePair();

      expect(entity.outputAsset.dexName).toBe('GOOGL');
    });

    it('assigns outputReferenceAsset to inputReferenceAsset, when outputAsset is the same', () => {
      const entity = createCustomBuyCrypto({
        inputReferenceAsset: 'XYZ',
        outputReferenceAsset: undefined,
        buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'XYZ' }) }),
      });

      expect(entity.outputReferenceAsset).toBeUndefined();

      const requiredAssetFetch = entity.defineAssetExchangePair();

      expect(requiredAssetFetch).toBe(null);
      expect(entity.outputAsset.dexName).toBe('XYZ');
      expect(entity.outputReferenceAsset.dexName).toBe('XYZ');
    });

    it('returns query pointer to BTC, when outputAsset is USDC and input asset is not EUR | CHF | USD | USDT', () => {
      const entity = createCustomBuyCrypto({
        outputReferenceAsset: undefined,
        inputReferenceAsset: 'ETH',
        buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'USDC' }) }),
      });

      expect(entity.outputReferenceAsset).toBeUndefined();

      const requiredAssetFetch = entity.defineAssetExchangePair();

      expect(requiredAssetFetch.outputReferenceAssetName).toBe('BTC');
      expect(requiredAssetFetch.type).toBe(AssetType.TOKEN);
      expect(entity.outputReferenceAsset).toBeUndefined();
    });

    it('assigns outputReferenceAsset to outputAsset, on BSC blockchain when outputAsset is BUSD', () => {
      const entity = createCustomBuyCrypto({
        outputReferenceAsset: undefined,
        buy: createCustomBuy({
          asset: createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, dexName: 'BUSD' }),
        }),
      });

      expect(entity.outputReferenceAsset).toBeUndefined();

      const requiredAssetFetch = entity.defineAssetExchangePair();

      expect(requiredAssetFetch).toBe(null);
      expect(entity.outputReferenceAsset.dexName).toBe('BUSD');
    });

    it('assigns outputReferenceAsset to outputAsset, on BSC blockchain when outputAsset is MANA', () => {
      const entity = createCustomBuyCrypto({
        outputReferenceAsset: undefined,
        buy: createCustomBuy({
          asset: createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, dexName: 'MANA' }),
        }),
      });

      expect(entity.outputReferenceAsset).toBeUndefined();

      const requiredAssetFetch = entity.defineAssetExchangePair();

      expect(requiredAssetFetch).toBe(null);
      expect(entity.outputReferenceAsset.dexName).toBe('MANA');
    });

    it('defaults outputReferenceAsset to BTC on Bitcoin blockchain', () => {
      const entity = createCustomBuyCrypto({
        outputReferenceAsset: undefined,
        buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'XYZ', blockchain: Blockchain.BITCOIN }) }),
      });

      expect(entity.outputReferenceAsset).toBeUndefined();

      const requiredAssetFetch = entity.defineAssetExchangePair();

      expect(entity.outputReferenceAsset).toBeUndefined();
      expect(requiredAssetFetch.outputReferenceAssetName).toBe('BTC');
    });

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
});
