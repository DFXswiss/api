import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { Setting } from './setting.entity';

@Injectable()
export class SettingRepository extends CachedRepository<Setting> {
  constructor(manager: EntityManager) {
    super(Setting, manager);
  }

  /**
   * Atomically advances an ISO date setting without allowing a stale worker to move it backwards.
   * The transaction-scoped advisory lock also covers the first insert, where no row exists to lock yet.
   */
  async setDateMax(key: string, candidate: Date): Promise<void> {
    await this.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);

      const setting = await manager.findOneBy(Setting, { key });
      if (setting) {
        const current = new Date(setting.value);
        if (Number.isNaN(current.getTime())) throw new Error(`Setting '${key}' does not contain a valid ISO date`);
        if (current >= candidate) return;
        setting.value = candidate.toISOString();
        await manager.save(setting);
      } else {
        await manager.save(manager.create(Setting, { key, value: candidate.toISOString() }));
      }
    });

    this.invalidateCache();
  }

  async getStatusSettings(): Promise<Setting[]> {
    return this.createQueryBuilder('setting').where('setting.key LIKE :suffix', { suffix: '%Status' }).getMany();
  }
}
