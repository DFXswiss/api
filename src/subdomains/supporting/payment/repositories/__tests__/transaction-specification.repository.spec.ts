import { createMock } from '@golevelup/ts-jest';
import { EntityManager } from 'typeorm';
import { TransactionDirection, TransactionSpecification } from '../../entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from '../transaction-specification.repository';

function createSpec(values: Partial<TransactionSpecification>): TransactionSpecification {
  return Object.assign(new TransactionSpecification(), { system: 'Fiat', minVolume: 1, minFee: 0, ...values });
}

// The repository extends CachedRepository so that FiatController.getAllFiat and AssetController.getAllAsset
// stop issuing one query per request. These tests pin the caching behaviour itself, because the switch from
// find() to findCached() leaves the returned data unchanged.
describe('TransactionSpecificationRepository.findCached', () => {
  const specs = [createSpec({ asset: 'EUR', direction: TransactionDirection.IN, minVolume: 5 })];

  let repository: TransactionSpecificationRepository;
  let find: jest.SpyInstance;

  beforeEach(() => {
    repository = new TransactionSpecificationRepository(createMock<EntityManager>());
    find = jest.spyOn(repository, 'find').mockResolvedValue(specs);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queries the database once and serves the following calls from the cache', async () => {
    await expect(repository.findCached('all')).resolves.toBe(specs);
    await expect(repository.findCached('all')).resolves.toBe(specs);
    await expect(repository.findCached('all')).resolves.toBe(specs);

    expect(find).toHaveBeenCalledTimes(1);
  });

  it('issues a single query for concurrent calls', async () => {
    const [first, second] = await Promise.all([repository.findCached('all'), repository.findCached('all')]);

    expect(first).toBe(specs);
    expect(second).toBe(specs);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('queries again after invalidateCache', async () => {
    await repository.findCached('all');

    repository.invalidateCache();
    const updated = [createSpec({ asset: 'CHF', direction: TransactionDirection.IN, minVolume: 9 })];
    find.mockResolvedValue(updated);

    await expect(repository.findCached('all')).resolves.toBe(updated);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('propagates a failing query instead of returning a stale or empty result', async () => {
    find.mockRejectedValue(new Error('connection terminated'));

    await expect(repository.findCached('all')).rejects.toThrow('connection terminated');

    find.mockResolvedValue(specs);
    await expect(repository.findCached('all')).resolves.toBe(specs);
    expect(find).toHaveBeenCalledTimes(2);
  });

  // The repository passes CacheItemResetPeriod.EVERY_HOUR explicitly. Dropping that argument would fall back
  // to the CachedRepository default of 5 minutes without any other visible effect, so the window is asserted
  // here: the first case fails on the default, the second one fails if the entry never expires.
  it('serves the cached list well past the 5 minute default', async () => {
    jest.useFakeTimers();

    await repository.findCached('all');
    jest.advanceTimersByTime(59 * 60 * 1000);
    await repository.findCached('all');

    expect(find).toHaveBeenCalledTimes(1);
  });

  it('queries again once the hour has passed', async () => {
    jest.useFakeTimers();

    await repository.findCached('all');
    jest.advanceTimersByTime(61 * 60 * 1000);
    await repository.findCached('all');

    expect(find).toHaveBeenCalledTimes(2);
  });

  it('keeps a separate cache entry per key', async () => {
    const inSpecs = [createSpec({ direction: TransactionDirection.IN })];
    const outSpecs = [createSpec({ direction: TransactionDirection.OUT })];
    find.mockResolvedValueOnce(inSpecs).mockResolvedValueOnce(outSpecs);

    await expect(repository.findCached('in')).resolves.toBe(inSpecs);
    await expect(repository.findCached('out')).resolves.toBe(outSpecs);
    await expect(repository.findCached('in')).resolves.toBe(inSpecs);

    expect(find).toHaveBeenCalledTimes(2);
  });
});
