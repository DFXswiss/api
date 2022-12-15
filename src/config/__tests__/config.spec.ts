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

  it('should return default transaction minVolume EUR', () => {
    expect(Config.transaction.minVolume.get(createDefaultFiat(), 'EUR')).toStrictEqual([{ amount: 1, asset: 'EUR' }]);
  });

  it('should return Fiat transaction minVolume USD', () => {
    expect(Config.transaction.minVolume.get(createCustomFiat({ name: 'USD' }), 'USD')).toStrictEqual([
      { amount: 1000, asset: 'USD' },
    ]);
  });

  it('should return Ethereum transaction minVolume CHF', () => {
    expect(
      Config.transaction.minVolume.get(createCustomAsset({ name: 'ETH', blockchain: Blockchain.ETHEREUM }), 'CHF'),
    ).toStrictEqual([{ amount: 1000, asset: 'CHF' }]);
  });
});
