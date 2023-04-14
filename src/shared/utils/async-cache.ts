import { Util } from './util';

export class AsyncCache<T> {
  private readonly cache = new Map<string, { updated: Date; data: T }>();

  constructor(private readonly itemValiditySeconds?: number) {}

  async get(id: string, update: () => Promise<T>): Promise<T> {
    if (!(this.cache.get(id)?.updated > this.expiration)) {
      const data = await update();
      this.cache.set(id, { updated: new Date(), data });
    }

    return this.cache.get(id).data;
  }

  private get expiration(): Date {
    return this.itemValiditySeconds ? Util.secondsBefore(this.itemValiditySeconds) : new Date(0);
  }
}
