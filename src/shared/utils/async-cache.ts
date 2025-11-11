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
}

export class AsyncCache<T> {
  private readonly cache = new Map<string, { updated: Date; data: T; update?: Promise<void> }>();

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
      await this.updateInternal(id, update, fallbackToCache);
    }

    return this.cache.get(id).data;
  }

  invalidate(id?: string): void {
    if (!id) return this.cache.clear();

    this.cache.delete(id);
  }

  private async updateInternal(id: string, update: () => Promise<T>, fallbackToCache: boolean) {
    try {
      // wait for an existing update
      const entry = this.cache.get(id);
      if (entry?.update != null) return await entry.update;

      const updateCall = update()
        .then((data) => {
          this.cache.set(id, { updated: new Date(), data });
        })
        .finally(() => this.cache.set(id, { ...this.cache.get(id), update: undefined }));

      this.cache.set(id, { ...entry, update: updateCall });

      await updateCall;
    } catch (e) {
      if (!fallbackToCache || !this.cache.has(id)) throw e;
    }
  }

  private get expiration(): Date {
    return this.itemValiditySeconds != null ? Util.secondsBefore(this.itemValiditySeconds) : new Date(0);
  }
}
