import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { Util } from 'src/shared/utils/util';
import { EntityManager } from 'typeorm';
import { LogCleanupSetting } from './dto/create-log.dto';
import { Log } from './log.entity';

@Injectable()
export class LogRepository extends BaseRepository<Log> {
  constructor(manager: EntityManager) {
    super(Log, manager);
  }

  async keepOnePerDay(logCleanupSetting: LogCleanupSetting): Promise<void> {
    const subQuery = this.createQueryBuilder('subLog')
      .select('MAX(subLog.id)', 'max_id')
      .where('subLog.system=log.system')
      .andWhere('subLog.subsystem=log.subsystem')
      .groupBy('CAST(subLog.created as DATE)');

    const system = logCleanupSetting.system;
    const subsystem = logCleanupSetting.subsystem;

    const logIdsToBeDeleted = await this.createQueryBuilder('log')
      .select('log.id', 'log_id')
      .where(`log.id NOT IN (${subQuery.getQuery()})`)
      .andWhere('log.system=:system', { system })
      .andWhere('log.subsystem=:subsystem', { subsystem })
      .getRawMany<{ log_id: number }>()
      .then((i) => i.map((i) => i.log_id));

    await Util.doInBatches(logIdsToBeDeleted, async (batch: number[]) => this.delete(batch), 100);
  }
}
