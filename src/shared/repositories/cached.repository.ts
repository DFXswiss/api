import { EntityManager, EntityTarget, FindOneOptions, FindOptionsWhere } from 'typeorm';
import { AsyncCache, CacheItemResetPeriod } from '../utils/async-cache';
import { BaseRepository } from './base.repository';

export abstract class CachedRepository<T> extends BaseRepository<T> {
  private readonly cache: AsyncCache<T>;
  private readonly listCache: AsyncCache<T[]>;

  constructor(target: EntityTarget<T>, manager: EntityManager, period = CacheItemResetPeriod.EVERY_5_MINUTES) {
    super(target, manager);
    this.cache = new AsyncCache<T>(period);
    this.listCache = new AsyncCache<T[]>(period);
  }

  async findOneCached(id: number | string, options: FindOneOptions<T>): Promise<T> {
    return this.cache.get(this.toStringId(id), () => this.findOne(options));
  }

  async findOneCachedBy(id: number | string, where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<T> {
    return this.cache.get(this.toStringId(id), () => this.findOneBy(where));
  }

  async findCached(id: number | string, options?: FindOneOptions<T>): Promise<T[]> {
    return this.listCache.get(this.toStringId(id), () => this.find(options));
  }

  async findCachedBy(id: number | string, where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<T[]> {
    return this.listCache.get(this.toStringId(id), () => this.findBy(where));
  }

  invalidateCache(): void {
    this.cache.invalidate();
    this.listCache.invalidate();
  }

  private toStringId(id: number | string): string {
    return typeof id === 'string' ? id : `${id}`;
  }
}
