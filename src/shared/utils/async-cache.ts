import { Util } from './util';

export enum CacheItemResetPeriod {
  ALWAYS = 0,
  EVERY_10_SECONDS = 10,
  EVERY_30_SECONDS = 30,
  EVERY_1_MINUTE = 60,
  EVERY_5_MINUTES = 5 * 60,
  EVERY_HOUR = 3600,
  EVERY_6_HOURS = 3600 * 6,
  EVERY_24_HOURS = 3600 * 24,
  EVERY_6_MONTHS = 3600 * 24 * 30 * 6,
}

export class AsyncCache<T> {
  // holds complete entries only: an item without data/updated can never exist, so neither an
  // in-flight nor a discarded update can leave a half-written entry behind
  private readonly cache = new Map<string, { updated: Date; data: T }>();

  // updates currently in flight, kept separate from the data so that parallel get() calls for the
  // same id share a single update() call; the promise resolves with the fetched data
  private readonly updateCalls = new Map<string, Promise<T>>();

  // Monotonically increasing invalidation counter. A refresh captures it when it starts and writes
  // its result back only if it is still unchanged. Without this guard, a refresh started before an
  // invalidate() would repopulate the cache after it - with a fresh timestamp - and thereby undo
  // the invalidation for up to a full item validity period. Callers rely on an invalidation taking
  // effect immediately (e.g. FiatService.updatePrice() writing a price and then invalidating the
  // repository cache), so the stale write-back must be dropped instead.
  // The counter is deliberately instance-wide and not per key: invalidate('a') therefore also
  // discards an in-flight refresh for key 'b'. That is intentionally conservative and harmless -
  // the caller still receives its data, only the cache entry is missing and is re-fetched on the
  // next access.
  private generation = 0;

  constructor(private readonly itemValiditySeconds?: CacheItemResetPeriod) {}

  async get(
    id: string,
    update: () => Promise<T>,
    forceUpdate?: (entry: T) => boolean,
    fallbackToCache = false,
  ): Promise<T> {
    if (!id) throw new Error('Error in AsyncCache: id is null');

    const entry = this.cache.get(id);
    if (entry?.data == null || forceUpdate?.(entry.data) || entry.updated <= this.expiration) {
      // the fetched data is handed through instead of being read back from the cache: a concurrent
      // invalidate() may have discarded the write-back, but the caller must still get its data
      return this.updateInternal(id, update, fallbackToCache);
    }

    return entry.data;
  }

  invalidate(id?: string): void {
    // bumped by both forms, so every refresh that is currently in flight loses its write-back
    this.generation++;

    if (!id) {
      this.cache.clear();
      this.updateCalls.clear();
      return;
    }

    this.cache.delete(id);
    this.updateCalls.delete(id);
  }

  private async updateInternal(id: string, update: () => Promise<T>, fallbackToCache: boolean): Promise<T> {
    try {
      // wait for an existing update
      const pendingCall = this.updateCalls.get(id);
      if (pendingCall != null) return await pendingCall;

      const generation = this.generation;

      // the type is annotated because the finally handler refers to the promise it belongs to
      const updateCall: Promise<T> = update()
        .then((data) => {
          if (generation === this.generation) this.cache.set(id, { updated: new Date(), data });

          return data;
        })
        .finally(() => {
          // only clear our own in-flight marker, a newer update may have replaced it in the meantime
          if (this.updateCalls.get(id) === updateCall) this.updateCalls.delete(id);
        });

      this.updateCalls.set(id, updateCall);

      return await updateCall;
    } catch (e) {
      const cachedEntry = this.cache.get(id);
      if (!fallbackToCache || cachedEntry == null) throw e;

      return cachedEntry.data;
    }
  }

  private get expiration(): Date {
    return this.itemValiditySeconds != null ? Util.secondsBefore(this.itemValiditySeconds) : new Date(0);
  }
}
