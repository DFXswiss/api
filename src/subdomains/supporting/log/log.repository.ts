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

  async cleanup(logCleanupSetting: LogCleanupSetting): Promise<void> {
    const system = logCleanupSetting.system;
    const subsystem = logCleanupSetting.subsystem;
    const saveDays = logCleanupSetting.saveDays;

    const saveDate = Util.daysBefore(saveDays);
    saveDate.setHours(0, 0, 0, 0);

    let query = this.createQueryBuilder('log')
      .select('log.id', 'log_id')
      .where('log.system=:system', { system })
      .andWhere('log.subsystem=:subsystem', { subsystem })
      .andWhere('log.created<:saveDate', { saveDate });

    if (logCleanupSetting.keepOnePerDay) {
      const subQuery = this.createQueryBuilder('subLog')
        .select('MAX(subLog.id)', 'max_id')
        .where('subLog.system=log.system')
        .andWhere('subLog.subsystem=log.subsystem')
        .groupBy('CAST(subLog.created as DATE)');

      query = query.andWhere(`log.id NOT IN (${subQuery.getQuery()})`);
    }

    const logIdsToBeDeleted = await query.getRawMany<{ log_id: number }>().then((i) => i.map((i) => i.log_id));

    await Util.doInBatches(logIdsToBeDeleted, async (batch: number[]) => this.delete(batch), 100);
  }
}
