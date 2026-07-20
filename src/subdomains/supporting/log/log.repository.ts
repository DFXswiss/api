import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { Util } from 'src/shared/utils/util';
import {
  EntityManager,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  SelectQueryBuilder,
  UpdateQueryBuilder,
} from 'typeorm';
import { LogCleanupSetting } from './dto/create-log.dto';
import { SetFinancialLogValidityDto } from './dto/set-financial-log-validity.dto';
import { FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM, Log, LogSeverity } from './log.entity';

@Injectable()
export class LogRepository extends BaseRepository<Log> {
  constructor(manager: EntityManager) {
    super(Log, manager);
  }

  async cleanup(logCleanupSetting: LogCleanupSetting): Promise<void> {
    // Auditable mutations: audit records must remain recoverable and are never eligible for generic cleanup.
    if (logCleanupSetting.subsystem === FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM) return;

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

  // Unfiltered: exposes the exact newest snapshot for numeric balance displays.
  async getLatestFinancialLog(): Promise<Log | undefined> {
    return this.findOne({
      where: { system: 'LogService', subsystem: 'FinancialDataLog', severity: LogSeverity.INFO },
      order: { id: 'DESC' },
    });
  }

  // The last `count` VALID FinancialDataLog snapshots, newest first. Used by the ledger equity-parity check to build
  // a median baseline that is robust against the transient ±snapshot-skew spikes the FinancialDataLog carries
  // (valid=false spikes are already excluded here); see BalancesTotal (log.dto.ts, case 4).
  async getLatestValidFinancialLogs(count: number): Promise<Log[]> {
    return this.find({
      where: { system: 'LogService', subsystem: 'FinancialDataLog', severity: LogSeverity.INFO, valid: true },
      order: { id: 'DESC' },
      take: count,
    });
  }

  async getLatestFinancialChangesLog(): Promise<Log | undefined> {
    return this.findOne({
      where: { system: 'LogService', subsystem: 'FinancialChangesLog', severity: LogSeverity.INFO },
      order: { id: 'DESC' },
    });
  }

  async getFinancialChangesLogs(from?: Date, dailySample?: boolean): Promise<Log[]> {
    if (dailySample) {
      const subQuery = this.createQueryBuilder('subLog')
        .select('MAX(subLog.id)', 'max_id')
        .where('subLog.system = :system', { system: 'LogService' })
        .andWhere('subLog.subsystem = :subsystem', { subsystem: 'FinancialChangesLog' })
        .andWhere('subLog.severity = :severity', { severity: LogSeverity.INFO })
        .groupBy('CAST(subLog.created AS DATE)');

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
      subsystem: 'FinancialChangesLog',
      severity: LogSeverity.INFO,
    };

    if (from) {
      where.created = MoreThanOrEqual(from);
    }

    return this.find({ where, order: { created: 'ASC' } });
  }

  // Filters valid = true so chart series skip spike/glitch snapshots; use getLatestFinancialLog for exact numeric values.
  async getFinancialLogs(from?: Date, dailySample?: boolean): Promise<Log[]> {
    if (dailySample) {
      const subQuery = this.createQueryBuilder('subLog')
        .select('MAX(subLog.id)', 'max_id')
        .where('subLog.system = :system', { system: 'LogService' })
        .andWhere('subLog.subsystem = :subsystem', { subsystem: 'FinancialDataLog' })
        .andWhere('subLog.severity = :severity', { severity: LogSeverity.INFO })
        .andWhere('subLog.valid = :valid', { valid: true })
        .groupBy('CAST(subLog.created AS DATE)');

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
      subsystem: 'FinancialDataLog',
      severity: LogSeverity.INFO,
      valid: true,
    };

    if (from) {
      where.created = MoreThanOrEqual(from);
    }

    return this.find({ where, order: { created: 'ASC' } });
  }

  async getFinancialLogValidityChangeSet(
    dto: SetFinancialLogValidityDto,
  ): Promise<{ id: number; valid: boolean | null }[]> {
    const query = this.createQueryBuilder('log').select(['log.id', 'log.valid']);
    this.addFinancialLogValidityConditions(query, dto);

    const logs = await query.getRawMany<{ log_id: number; log_valid: boolean | null }>();
    return logs.map(({ log_id, log_valid }) => {
      if (log_valid === undefined) throw new Error(`Missing validity value for financial log ${log_id}`);
      return { id: log_id, valid: log_valid };
    });
  }

  // Bulk-sets the valid flag on FinancialDataLog entries matched by an optional created range
  // ([from inclusive, to exclusive) — same half-open window as the daily migrations) and/or
  // totalBalanceChf bounds (min exclusive lower, max exclusive upper). Only rows whose current
  // valid differs are touched, so affected reflects actually-changed rows and re-runs are no-ops.
  async setFinancialLogValidity(dto: SetFinancialLogValidityDto, ids: number[]): Promise<number> {
    const affected = await Util.doInBatches(
      ids,
      async (batch: number[]): Promise<number> => {
        const query = this.createQueryBuilder().update(Log).set({ valid: dto.valid });
        this.addFinancialLogValidityConditions(query, dto);
        query.andWhere('id IN (:...ids)', { ids: batch });

        const { affected: batchAffected } = await query.execute();
        return batchAffected as number;
      },
      100,
    );
    return affected.reduce((total, batchAffected) => total + batchAffected, 0);
  }

  private addFinancialLogValidityConditions(
    query: SelectQueryBuilder<Log> | UpdateQueryBuilder<Log>,
    dto: SetFinancialLogValidityDto,
  ): void {
    const balanceChf = `(CAST(message AS jsonb) -> 'balancesTotal' ->> 'totalBalanceChf')::numeric`;

    query
      .where('system = :system', { system: 'LogService' })
      .andWhere('subsystem = :subsystem', { subsystem: 'FinancialDataLog' })
      .andWhere('severity = :severity', { severity: LogSeverity.INFO })
      .andWhere('valid IS DISTINCT FROM :targetValid', { targetValid: dto.valid });

    if (dto.from) query.andWhere('created >= :from', { from: dto.from });
    if (dto.to) query.andWhere('created < :to', { to: dto.to });
    if (dto.min != null) query.andWhere(`${balanceChf} > :min`, { min: dto.min });
    if (dto.max != null) query.andWhere(`${balanceChf} < :max`, { max: dto.max });
  }
}
