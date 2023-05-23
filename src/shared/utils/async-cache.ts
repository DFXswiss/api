import { Util } from './util';

export class AsyncCache<T> {
  private readonly cache = new Map<string, { updated: Date; data: T }>();

  constructor(private readonly itemValiditySeconds?: number) {}

  async get(id: string, update: () => Promise<T>, fallbackToCache = false): Promise<T> {
    if (!(this.cache.get(id)?.updated > this.expiration)) {
      await this.update(id, update, fallbackToCache);
    }

    return this.cache.get(id).data;
  }

  private async update(id: string, update: () => Promise<T>, fallbackToCache: boolean) {
    try {
      const data = await update();
      this.cache.set(id, { updated: new Date(), data });
    } catch (e) {
      if (!fallbackToCache || !this.cache.has(id)) throw e;
    }
  }

  private get expiration(): Date {
    return this.itemValiditySeconds ? Util.secondsBefore(this.itemValiditySeconds) : new Date(0);
  }
}
