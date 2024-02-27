import { Util } from './util';

export class AsyncCache<T> {
  private readonly cache = new Map<string, { updated: Date; data: T; update?: Promise<void> }>();

  constructor(private readonly itemValiditySeconds?: number) {}

  async get(id: string, update: () => Promise<T>, fallbackToCache = false): Promise<T> {
    if (!id) throw new Error('Error in AsyncCache: id is null');
    if (!(this.cache.get(id)?.updated > this.expiration)) {
      await this.update(id, update, fallbackToCache);
    }

    return this.cache.get(id).data;
  }

  private async update(id: string, update: () => Promise<T>, fallbackToCache: boolean) {
    try {
      // wait for an existing update
      const entry = this.cache.get(id);
      if (entry?.update) return await entry.update;

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
