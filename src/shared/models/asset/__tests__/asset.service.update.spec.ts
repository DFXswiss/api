import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { UpdateResult } from '../../entity';
import { Asset } from '../asset.entity';
import { AssetRepository } from '../asset.repository';
import { AssetService } from '../asset.service';

// updateAssets is the only write path that reaches the repository instance the cached reads are
// served from, so what it does around invalidateCache decides whether readers see the new rows.
describe('AssetService.updateAssets', () => {
  const updates: UpdateResult<Asset>[] = [
    [7, { decimals: 6 }],
    [9, { decimals: 18 }],
  ];

  let service: AssetService;
  let assetRepo: DeepMocked<AssetRepository>;

  beforeEach(() => {
    assetRepo = createMock<AssetRepository>();
    service = new AssetService(assetRepo);
  });

  it('writes every update and invalidates the cache once', async () => {
    await service.updateAssets(updates);

    expect(assetRepo.update).toHaveBeenCalledTimes(2);
    expect(assetRepo.update).toHaveBeenCalledWith(7, { decimals: 6 });
    expect(assetRepo.update).toHaveBeenCalledWith(9, { decimals: 18 });
    expect(assetRepo.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache even when an update fails, so the earlier writes are not left stale', async () => {
    assetRepo.update.mockResolvedValueOnce(undefined as never).mockRejectedValueOnce(new Error('deadlock'));

    await expect(service.updateAssets(updates)).rejects.toThrow('deadlock');

    expect(assetRepo.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('does not touch the cache when there is nothing to write', async () => {
    await service.updateAssets([]);

    expect(assetRepo.update).not.toHaveBeenCalled();
    expect(assetRepo.invalidateCache).not.toHaveBeenCalled();
  });
});
