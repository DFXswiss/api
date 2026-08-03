import { AsyncCache, CacheItemResetPeriod } from '../async-cache';

describe('AsyncCache', () => {
  let mockUpdate: jest.Mock;
  let mockValue: string;

  beforeEach(() => {
    mockValue = 'test-value';
    mockUpdate = jest.fn().mockResolvedValue(mockValue);
  });

  describe('get', () => {
    it('should throw when the id is missing', async () => {
      const cache = new AsyncCache<string>();

      await expect(cache.get('', mockUpdate)).rejects.toThrow('Error in AsyncCache: id is null');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should return the fetched data', async () => {
      const cache = new AsyncCache<string>();

      const result = await cache.get('id', mockUpdate);

      expect(result).toBe(mockValue);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it('should serve a second call from the cache when there is no validity period', async () => {
      const cache = new AsyncCache<string>();

      const first = await cache.get('id', mockUpdate);
      const second = await cache.get('id', mockUpdate);

      expect(first).toBe(mockValue);
      expect(second).toBe(mockValue);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it('should keep separate entries per id', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const update = jest.fn().mockResolvedValueOnce('value-a').mockResolvedValueOnce('value-b');

      const resultA = await cache.get('a', update);
      const resultB = await cache.get('b', update);

      expect(resultA).toBe('value-a');
      expect(resultB).toBe('value-b');
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('should re-fetch when forceUpdate returns true', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const update = jest.fn().mockResolvedValueOnce('first').mockResolvedValue('second');

      await cache.get('id', update);
      const result = await cache.get('id', update, (entry) => entry === 'first');

      expect(result).toBe('second');
      expect(update).toHaveBeenCalledTimes(2);
    });
  });

  describe('expiration', () => {
    it('should not re-fetch a fresh entry', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);

      await cache.get('id', mockUpdate);
      await cache.get('id', mockUpdate);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it('should re-fetch an expired entry', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.ALWAYS);
      const update = jest.fn().mockResolvedValueOnce('first').mockResolvedValue('second');

      const first = await cache.get('id', update);
      const second = await cache.get('id', update);

      expect(first).toBe('first');
      expect(second).toBe('second');
      expect(update).toHaveBeenCalledTimes(2);
    });
  });

  describe('deduplication', () => {
    it('should trigger only one update for parallel calls on the same id', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const update = jest
        .fn()
        .mockImplementation(() => new Promise<string>((resolve) => setTimeout(() => resolve('shared'), 20)));

      const results = await Promise.all([cache.get('id', update), cache.get('id', update)]);

      expect(results).toEqual(['shared', 'shared']);
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('should trigger one update per id for parallel calls on different ids', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const update = jest
        .fn()
        .mockImplementationOnce(() => new Promise<string>((resolve) => setTimeout(() => resolve('value-a'), 20)))
        .mockImplementationOnce(() => new Promise<string>((resolve) => setTimeout(() => resolve('value-b'), 20)));

      const results = await Promise.all([cache.get('a', update), cache.get('b', update)]);

      expect(results).toEqual(['value-a', 'value-b']);
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('should propagate a failing shared update to all waiting callers', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const update = jest.fn().mockRejectedValue(new Error('update failed'));

      // both calls are issued before the event loop is yielded to, so the second one joins the
      // update of the first instead of starting its own
      const first = cache.get('id', update).then(
        (v) => v,
        (e) => e.message,
      );
      const second = cache.get('id', update).then(
        (v) => v,
        (e) => e.message,
      );

      const results = await Promise.all([first, second]);

      expect(results).toEqual(['update failed', 'update failed']);
      expect(update).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidate', () => {
    it('should drop only the given id when called with an id', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const updateA = jest.fn().mockResolvedValue('value-a');
      const updateB = jest.fn().mockResolvedValue('value-b');

      await cache.get('a', updateA);
      await cache.get('b', updateB);

      cache.invalidate('a');

      await cache.get('a', updateA);
      await cache.get('b', updateB);

      expect(updateA).toHaveBeenCalledTimes(2);
      expect(updateB).toHaveBeenCalledTimes(1);
    });

    it('should drop all entries when called without an id', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const updateA = jest.fn().mockResolvedValue('value-a');
      const updateB = jest.fn().mockResolvedValue('value-b');

      await cache.get('a', updateA);
      await cache.get('b', updateB);

      cache.invalidate();

      await cache.get('a', updateA);
      await cache.get('b', updateB);

      expect(updateA).toHaveBeenCalledTimes(2);
      expect(updateB).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidation during an in-flight update', () => {
    it('should not write back data that was fetched before the invalidation', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const update = jest
        .fn()
        .mockImplementationOnce(() => new Promise<string>((resolve) => setTimeout(() => resolve('stale'), 20)))
        .mockResolvedValue('fresh');

      const pending = cache.get('id', update);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      cache.invalidate('id');
      await pending;

      const result = await cache.get('id', update);

      expect(result).toBe('fresh');
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('should still return the fetched data to the caller of the discarded update', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const update = jest
        .fn()
        .mockImplementation(() => new Promise<string>((resolve) => setTimeout(() => resolve('stale'), 20)));

      const pending = cache.get('id', update);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      cache.invalidate('id');

      await expect(pending).resolves.toBe('stale');
    });

    it('should also discard an in-flight update for another id', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const update = jest
        .fn()
        .mockImplementationOnce(() => new Promise<string>((resolve) => setTimeout(() => resolve('stale'), 20)))
        .mockResolvedValue('fresh');

      const pending = cache.get('b', update);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      cache.invalidate('a');

      await expect(pending).resolves.toBe('stale');
      expect(await cache.get('b', update)).toBe('fresh');
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('should not leave a partial entry behind when the write-back is discarded', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const update = jest
        .fn()
        .mockImplementation(() => new Promise<string>((resolve) => setTimeout(() => resolve('stale'), 20)));

      const pending = cache.get('id', update);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      cache.invalidate('id');
      await pending;

      // there is no entry left, so there is nothing to fall back to and the error must surface
      const failingUpdate = jest.fn().mockRejectedValue(new Error('update failed'));

      await expect(cache.get('id', failingUpdate, undefined, true)).rejects.toThrow('update failed');
    });
  });

  describe('fallbackToCache', () => {
    it('should return the cached value when the update fails', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.ALWAYS);
      const update = jest.fn().mockResolvedValueOnce('cached').mockRejectedValue(new Error('update failed'));

      const first = await cache.get('id', update, undefined, true);
      const second = await cache.get('id', update, undefined, true);

      expect(first).toBe('cached');
      expect(second).toBe('cached');
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('should throw when the update fails and nothing is cached', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.EVERY_HOUR);
      const update = jest.fn().mockRejectedValue(new Error('update failed'));

      await expect(cache.get('id', update, undefined, true)).rejects.toThrow('update failed');
      await expect(cache.get('id', update, undefined, true)).rejects.toThrow('update failed');
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('should throw when the update fails and fallbackToCache is not set', async () => {
      const cache = new AsyncCache<string>(CacheItemResetPeriod.ALWAYS);
      const update = jest.fn().mockResolvedValueOnce('cached').mockRejectedValue(new Error('update failed'));

      await cache.get('id', update);

      await expect(cache.get('id', update)).rejects.toThrow('update failed');
      expect(update).toHaveBeenCalledTimes(2);
    });
  });
});
