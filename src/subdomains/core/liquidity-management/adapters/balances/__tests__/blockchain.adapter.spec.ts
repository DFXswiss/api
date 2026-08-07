import { createMock } from '@golevelup/ts-jest';
import { BlockchainTokenBalance } from 'src/integration/blockchain/shared/dto/blockchain-token-balance.dto';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { BlockchainAdapter } from '../blockchain.adapter';

describe('BlockchainAdapter', () => {
  const contract = '0xAAAA';

  let adapter: BlockchainAdapter;
  let client: EvmClient;
  let logError: jest.SpyInstance;
  let logWarn: jest.SpyInstance;

  beforeEach(() => {
    adapter = new BlockchainAdapter(createMock<DexService>(), createMock<BlockchainRegistryService>());

    logError = jest.spyOn(adapter['logger'], 'error').mockImplementation();
    logWarn = jest.spyOn(adapter['logger'], 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  function tokenAsset(): Asset {
    return createCustomAsset({
      id: 1,
      name: 'TKN',
      dexName: 'TKN',
      uniqueName: 'Ethereum/TKN',
      type: AssetType.TOKEN,
      chainId: contract,
    });
  }

  async function update(asset: Asset, tokenBalances: BlockchainTokenBalance[]): Promise<void> {
    client = createMock<EvmClient>({
      getNativeCoinBalance: jest.fn().mockResolvedValue(0),
      getTokenBalances: jest.fn().mockResolvedValue(tokenBalances),
    });

    await adapter['updateCoinAndTokenBalance']([asset], client);
  }

  function balance(value: number): BlockchainTokenBalance[] {
    return [{ owner: '0xowner', contractAddress: contract, balance: value }];
  }

  describe('updateCoinAndTokenBalance', () => {
    // An asset absent from the response and an asset reported as zero used to produce the same
    // line, `went to null`, which interpolated the literal null and so could not tell them apart.
    it('should report an asset missing from the response as unknown, not as zero', async () => {
      const asset = tokenAsset();
      adapter['balanceCache'].set(asset.id, 100);

      await update(asset, []);

      expect(logWarn).toHaveBeenCalledWith('No balance reported for Ethereum/TKN, keeping 100');
      expect(logError).not.toHaveBeenCalled();
    });

    it('should keep the previous balance cached when the asset is missing from the response', async () => {
      const asset = tokenAsset();
      adapter['balanceCache'].set(asset.id, 100);

      await update(asset, []);

      expect(adapter['balanceCache'].get(asset.id)).toEqual(100);
    });

    it('should report a real drop to zero as an error naming the previous balance', async () => {
      const asset = tokenAsset();
      adapter['balanceCache'].set(asset.id, 100);

      await update(asset, balance(0));

      expect(logError).toHaveBeenCalledWith('Balance for Ethereum/TKN went to 0, was 100');
      expect(logWarn).not.toHaveBeenCalled();
      expect(adapter['balanceCache'].get(asset.id)).toEqual(0);
    });

    it('should not report an ordinary balance change', async () => {
      const asset = tokenAsset();
      adapter['balanceCache'].set(asset.id, 100);

      await update(asset, balance(50));

      expect(logError).not.toHaveBeenCalled();
      expect(logWarn).not.toHaveBeenCalled();
      expect(adapter['balanceCache'].get(asset.id)).toEqual(50);
    });

    it('should not report anything when there was no previous balance', async () => {
      const asset = tokenAsset();

      await update(asset, []);

      expect(logError).not.toHaveBeenCalled();
      expect(logWarn).not.toHaveBeenCalled();
    });
  });
});
