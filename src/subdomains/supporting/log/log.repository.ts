import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { Util } from 'src/shared/utils/util';
import { EntityManager, FindOptionsWhere, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { LogCleanupSetting } from './dto/create-log.dto';
import { Log, LogSeverity } from './log.entity';
import { getSampleIntervalMinutes } from './log.util';

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

  async getFinancialLogAt(targetDate: Date, direction: 'before' | 'after'): Promise<Log | undefined> {
    return this.findOne({
      where: {
        system: 'LogService',
        subsystem: 'FinancialDataLog',
        severity: LogSeverity.INFO,
        created: direction === 'before' ? LessThanOrEqual(targetDate) : MoreThanOrEqual(targetDate),
      },
      order: { created: direction === 'before' ? 'DESC' : 'ASC' },
    });
  }

  async getLatestFinancialLog(): Promise<Log | undefined> {
    return this.findOne({
      where: { system: 'LogService', subsystem: 'FinancialDataLog', severity: LogSeverity.INFO },
      order: { id: 'DESC' },
    });
  }

  async getLatestFinancialChangesLog(): Promise<Log | undefined> {
    return this.findOne({
      where: { system: 'LogService', subsystem: 'FinancialChangesLog', severity: LogSeverity.INFO },
      order: { id: 'DESC' },
    });
  }

  async getFinancialChangesLogs(from?: Date, dailySample?: boolean): Promise<Log[]> {
    return this.getSampledFinancialLogs('FinancialChangesLog', from, dailySample);
  }

  async getFinancialLogs(from?: Date, dailySample?: boolean): Promise<Log[]> {
    return this.getSampledFinancialLogs('FinancialDataLog', from, dailySample);
  }

  private async getSampledFinancialLogs(subsystem: string, from?: Date, dailySample?: boolean): Promise<Log[]> {
    if (dailySample) {
      let subQuery = this.createQueryBuilder('subLog')
        .select('MAX(subLog.id)', 'max_id')
        .where('subLog.system = :system', { system: 'LogService' })
        .andWhere('subLog.subsystem = :subsystem', { subsystem })
        .andWhere('subLog.severity = :severity', { severity: LogSeverity.INFO });

      if (from) {
        subQuery = subQuery.andWhere('subLog.created >= :from', { from });
      }

      subQuery = subQuery.groupBy('CAST(subLog.created AS DATE)');

      let query = this.createQueryBuilder('log')
        .where(`log.id IN (${subQuery.getQuery()})`)
        .setParameters(subQuery.getParameters())
        .orderBy('log.created', 'ASC');

      if (from) {
        query = query.andWhere('log.created >= :from', { from });
      }

      return query.getMany();
    }

    const bucketMinutes = getSampleIntervalMinutes(from, dailySample);

    if (bucketMinutes != null) {
      // DB-side N-minute bucketing: pick the latest id per bucket, then fetch those rows.
      // Mirrors the dailySample shape but uses DATEADD/DATEDIFF for sub-day buckets.
      let subQuery = this.createQueryBuilder('subLog')
        .select('MAX(subLog.id)', 'max_id')
        .where('subLog.system = :system', { system: 'LogService' })
        .andWhere('subLog.subsystem = :subsystem', { subsystem })
        .andWhere('subLog.severity = :severity', { severity: LogSeverity.INFO });

      if (from) {
        subQuery = subQuery.andWhere('subLog.created >= :from', { from });
      }

      subQuery = subQuery.groupBy(
        `DATEADD(MINUTE, (DATEDIFF(MINUTE, 0, subLog.created) / ${bucketMinutes}) * ${bucketMinutes}, 0)`,
      );

      let query = this.createQueryBuilder('log')
        .where(`log.id IN (${subQuery.getQuery()})`)
        .setParameters(subQuery.getParameters())
        .orderBy('log.created', 'ASC');

      if (from) {
        query = query.andWhere('log.created >= :from', { from });
      }

      return query.getMany();
    }

    const where: FindOptionsWhere<Log> = {
      system: 'LogService',
      subsystem,
      severity: LogSeverity.INFO,
    };

    if (from) {
      where.created = MoreThanOrEqual(from);
    }

    return this.find({ where, order: { created: 'ASC' } });
  }
}
