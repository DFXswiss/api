import { Test } from '@nestjs/testing';
import { Config, Configuration } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { createCustomFiat, createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { TestUtil } from 'src/shared/utils/test.util';

describe('Config', () => {
  beforeEach(async () => {
    await Test.createTestingModule({
      providers: [TestUtil.provideConfig()],
    }).compile();
  });

  it('should transform configs min deposit to a min deposit array', () => {
    const config = new Configuration();
    expect(Config.transformToMinDeposit(config.blockchain.default.minDeposit.DeFiChain)).toStrictEqual([
      { amount: 0.01, asset: 'DFI' },
      { amount: 1, asset: 'USD' },
    ]);
  });

  it('should transform configs min deposit to a min deposit array and filter for DFI', () => {
    const config = new Configuration();
    expect(Config.transformToMinDeposit(config.blockchain.default.minDeposit.DeFiChain, 'DFI')).toStrictEqual([
      { amount: 0.01, asset: 'DFI' },
    ]);
  });

  it('should transform configs min deposit to a min deposit array and filter for DFI and USD', () => {
    const config = new Configuration();
    expect(Config.transformToMinDeposit(config.blockchain.default.minDeposit.DeFiChain, ['DFI', 'USD'])).toStrictEqual([
      { amount: 0.01, asset: 'DFI' },
      { amount: 1, asset: 'USD' },
    ]);
  });

  it('should return correct min volume for fiat and EUR', () => {
    expect(Config.transaction.minVolume.get(createDefaultFiat(), 'EUR')).toStrictEqual({ amount: 1, asset: 'EUR' });
  });

  it('should return correct min volume for fiat and USD', () => {
    expect(Config.transaction.minVolume.get(createCustomFiat({ name: 'USD' }), 'USD')).toStrictEqual({
      amount: 1000,
      asset: 'USD',
    });
  });

  it('should return correct min volume for ethereum and CHF', () => {
    expect(
      Config.transaction.minVolume.get(createCustomAsset({ name: 'ETH', blockchain: Blockchain.ETHEREUM }), 'CHF'),
    ).toStrictEqual({ amount: 1000, asset: 'CHF' });
  });

  it('should return correct min volume for BSC and USD', () => {
    expect(
      Config.transaction.minVolume.get(
        createCustomAsset({ name: 'BNB', blockchain: Blockchain.BINANCE_SMART_CHAIN }),
        'USD',
      ),
    ).toStrictEqual({ amount: 10, asset: 'USD' });
  });

  it('should fallback to USD on unknown currency', () => {
    expect(
      Config.transaction.minVolume.get(createCustomAsset({ name: 'DFI', blockchain: Blockchain.DEFICHAIN }), 'AED'),
    ).toStrictEqual({ amount: 1, asset: 'USD' });
  });

  it('should return all deposits, if currency not specified', () => {
    expect(
      Config.transaction.minVolume.getMany(createCustomAsset({ name: 'DFI', blockchain: Blockchain.DEFICHAIN })),
    ).toStrictEqual([
      { amount: 1, asset: 'USD' },
      { amount: 1, asset: 'CHF' },
      { amount: 1, asset: 'EUR' },
    ]);
  });
});
