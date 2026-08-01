import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainRegistryService } from '../../services/blockchain-registry.service';
import { EvmDecimalsService } from '../evm-decimals.service';

// The decimals it writes are read back through AssetService's cache. Writing past the service would
// leave that cache serving the previous rows, so these tests pin that the write goes through it.
describe('EvmDecimalsService.setDecimals', () => {
  const usdt = createCustomAsset({ id: 7, dexName: 'USDT', blockchain: Blockchain.ETHEREUM });
  const dai = createCustomAsset({ id: 9, dexName: 'DAI', blockchain: Blockchain.ETHEREUM });

  let service: EvmDecimalsService;
  let assetService: DeepMocked<AssetService>;
  let blockchainRegistry: DeepMocked<BlockchainRegistryService>;
  let getToken: jest.Mock;

  beforeEach(() => {
    assetService = createMock<AssetService>();
    blockchainRegistry = createMock<BlockchainRegistryService>();

    getToken = jest.fn().mockResolvedValue({ decimals: 6 });
    blockchainRegistry.getEvmClient.mockReturnValue({ getToken } as never);

    service = new EvmDecimalsService(assetService, blockchainRegistry);
  });

  it('writes the decimals through the service that owns the cache', async () => {
    assetService.getEvmAssetsWithoutDecimals.mockResolvedValue([usdt]);

    await service.setDecimals();

    expect(assetService.updateAssets).toHaveBeenCalledWith([[7, { decimals: 6 }]]);
  });

  it('collects every asset into a single write', async () => {
    assetService.getEvmAssetsWithoutDecimals.mockResolvedValue([usdt, dai]);

    await service.setDecimals();

    expect(assetService.updateAssets).toHaveBeenCalledTimes(1);
    expect(assetService.updateAssets).toHaveBeenCalledWith([
      [7, { decimals: 6 }],
      [9, { decimals: 6 }],
    ]);
  });

  it('does not write when no asset is missing its decimals', async () => {
    assetService.getEvmAssetsWithoutDecimals.mockResolvedValue([]);

    await service.setDecimals();

    expect(assetService.updateAssets).not.toHaveBeenCalled();
  });

  it('keeps the assets it could read when one lookup fails', async () => {
    assetService.getEvmAssetsWithoutDecimals.mockResolvedValue([usdt, dai]);
    getToken.mockRejectedValueOnce(new Error('node unreachable')).mockResolvedValueOnce({ decimals: 18 });

    await service.setDecimals();

    expect(assetService.updateAssets).toHaveBeenCalledWith([[9, { decimals: 18 }]]);
  });

  it('does not write when every lookup fails', async () => {
    assetService.getEvmAssetsWithoutDecimals.mockResolvedValue([usdt, dai]);
    getToken.mockRejectedValue(new Error('node unreachable'));

    await service.setDecimals();

    expect(assetService.updateAssets).not.toHaveBeenCalled();
  });
});
