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

    await expect(service.updateAssets(updates)).rejects.toThrow('9');

    expect(assetRepo.invalidateCache).toHaveBeenCalledTimes(1);
  });

  // A row that keeps failing used to be harmless because each asset was written on its own. It must
  // not become a blocker for every asset queued behind it.
  it('attempts every update even when one in the middle fails', async () => {
    const three: UpdateResult<Asset>[] = [
      [7, { decimals: 6 }],
      [8, { decimals: 8 }],
      [9, { decimals: 18 }],
    ];
    assetRepo.update
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('constraint violation'))
      .mockResolvedValueOnce(undefined as never);

    await expect(service.updateAssets(three)).rejects.toThrow('8');

    expect(assetRepo.update).toHaveBeenCalledTimes(3);
    expect(assetRepo.update).toHaveBeenLastCalledWith(9, { decimals: 18 });
    expect(assetRepo.invalidateCache).toHaveBeenCalledTimes(1);
  });

  // Whoever reads the log needs the database error itself, not a rendering of it.
  it('carries every original error, not just their text', async () => {
    const first = new Error('deadlock');
    const second = new Error('constraint violation');
    assetRepo.update.mockRejectedValueOnce(first).mockRejectedValueOnce(second);

    const error = await service.updateAssets(updates).catch((e) => e);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toContain('7');
    expect(error.message).toContain('9');
    expect(error.errors).toEqual([first, second]);
  });

  it('does not touch the cache when there is nothing to write', async () => {
    await service.updateAssets([]);

    expect(assetRepo.update).not.toHaveBeenCalled();
    expect(assetRepo.invalidateCache).not.toHaveBeenCalled();
  });
});
