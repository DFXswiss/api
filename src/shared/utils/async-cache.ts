import { Util } from './util';

export class AsyncCache<T> {
  private readonly cache = new Map<string, { updated: Date; data: T }>();

  constructor(private readonly itemValiditySeconds?: number) {}

  async get(id: string, update: () => Promise<T>, fallbackToCache = false): Promise<T> {
    if (!(this.cache.get(id)?.updated > this.expiration)) {
      try {
        const data = await update();
        this.cache.set(id, { updated: new Date(), data });
      } catch (e) {
        if (!fallbackToCache) throw e;
      }
    }

    return this.cache.get(id).data;
  }

  private get expiration(): Date {
    return this.itemValiditySeconds ? Util.secondsBefore(this.itemValiditySeconds) : new Date(0);
  }
}
