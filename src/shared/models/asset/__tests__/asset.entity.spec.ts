import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from '../__mocks__/asset.entity.mock';
import { Asset, AssetType } from '../asset.entity';

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

  describe('#isSameCoinAs(...)', () => {
    const payoutWalletCoin = createCustomAsset({
      name: 'XMR',
      uniqueName: 'Monero/XMR',
      dexName: 'XMR',
      type: AssetType.COIN,
      blockchain: Blockchain.MONERO,
    });
    const venueCoin = createCustomAsset({
      name: 'XMR',
      uniqueName: 'MEXC/XMR',
      dexName: 'XMR',
      type: AssetType.CUSTODY,
      blockchain: Blockchain.MEXC,
    });

    it('groups the same coin held at a venue with the same coin in the payout wallet', () => {
      expect(payoutWalletCoin.isSameCoinAs(venueCoin)).toBe(true);
      expect(venueCoin.isSameCoinAs(payoutWalletCoin)).toBe(true);
    });

    it('groups an asset with itself', () => {
      expect(payoutWalletCoin.isSameCoinAs(payoutWalletCoin)).toBe(true);
    });

    it('separates two different coins', () => {
      const zano = createCustomAsset({
        name: 'ZANO',
        uniqueName: 'MEXC/ZANO',
        dexName: 'ZANO',
        type: AssetType.CUSTODY,
        blockchain: Blockchain.MEXC,
      });

      expect(payoutWalletCoin.isSameCoinAs(zano)).toBe(false);
    });

    it('does not group a wrapped representation with the coin it is named after', () => {
      // DeFiChain dBTC carries dexName 'BTC' while being a different good; matching on dexName
      // would let a dBTC payout speak for real BTC
      const bitcoin = createCustomAsset({
        name: 'BTC',
        uniqueName: 'Bitcoin/BTC',
        dexName: 'BTC',
        type: AssetType.COIN,
        blockchain: Blockchain.BITCOIN,
      });
      const wrapped = createCustomAsset({
        name: 'dBTC',
        uniqueName: 'DeFiChain/dBTC',
        dexName: 'BTC',
        type: AssetType.TOKEN,
        blockchain: Blockchain.DEFICHAIN,
      });

      expect(bitcoin.isSameCoinAs(wrapped)).toBe(false);
    });

    it('does not group a testnet asset with its mainnet namesake', () => {
      const mainnet = createCustomAsset({
        name: 'BTC',
        uniqueName: 'Bitcoin/BTC',
        dexName: 'BTC',
        type: AssetType.COIN,
        blockchain: Blockchain.BITCOIN,
      });
      const testnet = createCustomAsset({
        name: 'BTC',
        uniqueName: 'BitcoinTestnet4/BTC',
        dexName: 'BTC',
        type: AssetType.COIN,
        blockchain: Blockchain.BITCOIN_TESTNET4,
      });

      expect(mainnet.isSameCoinAs(testnet)).toBe(false);
      expect(testnet.isSameCoinAs(mainnet)).toBe(false);
    });

    it('groups two testnet rows of the same ticker with each other', () => {
      const sepoliaEth = createCustomAsset({ name: 'ETH', blockchain: Blockchain.SEPOLIA });

      expect(sepoliaEth.isSameCoinAs(createCustomAsset({ name: 'ETH', blockchain: Blockchain.SEPOLIA }))).toBe(true);
    });
  });
});
