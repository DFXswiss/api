import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { CreateLogDto, LogCleanupSetting, UpdateLogDto } from './dto/create-log.dto';
import { SetFinancialLogValidityDto } from './dto/set-financial-log-validity.dto';
import {
  FINANCIAL_DATA_LOG_SUBSYSTEM,
  FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM,
  Log,
  LogSeverity,
  MAX_VALIDITY_SWEEP_ROWS,
} from './log.entity';
import { FinancialDashboardLogEntry, FinancialLogAssetPrice, LogRepository } from './log.repository';

@Injectable()
export class LogService {
  private readonly logger = new DfxLogger(LogService);

  constructor(
    private readonly logRepo: LogRepository,
    private readonly settingService: SettingService,
  ) {}

  @DfxCron(CronExpression.EVERY_DAY_AT_11PM, { process: Process.LOG_CLEANUP })
  async cleanup(): Promise<void> {
    const logCleanupSettings = await this.settingService.getObj<LogCleanupSetting[]>('logCleanup', []);

    for (const logCleanupSetting of logCleanupSettings) {
      await this.logRepo.cleanup(logCleanupSetting);
    }
  }

  async create(dto: CreateLogDto): Promise<Log> {
    // Auditable mutations: audit records may only originate from the sweep that they describe,
    // otherwise a caller could fabricate evidence of a sweep that never ran.
    if (dto.subsystem === FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM)
      throw new BadRequestException('Financial log validity audit records cannot be created through this endpoint');

    const maxEntity = await this.maxEntity(dto.system, dto.subsystem, dto.severity);
    if (dto.message === maxEntity?.message && dto.valid === maxEntity?.valid && dto.category === maxEntity?.category)
      return maxEntity;

    const newEntity = this.logRepo.create(dto);
    return this.logRepo.save(newEntity);
  }

  async update(id: number, dto: UpdateLogDto): Promise<Log> {
    const log = await this.logRepo.findOneBy({ id });
    if (!log) throw new NotFoundException('Log not found');
    // Auditable mutations: audit records are immutable through generic log update paths.
    if (log.subsystem === FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM)
      throw new BadRequestException('Financial log validity audit records cannot be updated');
    // Auditable mutations: validity of a financial snapshot may only change through the audited
    // sweep endpoint, which records the previous value before overwriting it.
    if (log.subsystem === FINANCIAL_DATA_LOG_SUBSYSTEM && dto.valid !== undefined)
      throw new BadRequestException('Financial log validity must be changed through PUT /log/financial/validity');

    return this.logRepo.save({ ...log, ...dto });
  }

  async setFinancialLogValidity(accountId: number, dto: SetFinancialLogValidityDto): Promise<{ affected: number }> {
    if (dto.from == null && dto.to == null && dto.min == null && dto.max == null)
      throw new BadRequestException('At least one filter (from, to, min or max) is required');
    if (dto.from && dto.to && dto.from > dto.to) throw new BadRequestException('from must not be after to');
    if (dto.min != null && dto.max != null && dto.min >= dto.max)
      throw new BadRequestException('min must be smaller than max');

    // One transaction: the change set is locked while it is audited and updated, so the recorded
    // pre-state cannot go stale and a failing batch rolls back the audit record with it. The
    // repository is re-created on the transaction manager to enrol its queries (repo-wide pattern).
    const affected = await this.logRepo.manager.transaction(async (manager): Promise<number> => {
      const txLogRepo = new LogRepository(manager);

      const changeSet = await txLogRepo.getFinancialLogValidityChangeSet(dto);
      if (!changeSet.length) return 0;
      if (changeSet.length > MAX_VALIDITY_SWEEP_ROWS)
        throw new BadRequestException(
          `Financial log validity sweep matches more than ${MAX_VALIDITY_SWEEP_ROWS} rows; narrow the time or amount range`,
        );

      const previous = { true: [] as number[], false: [] as number[], null: [] as number[] };
      for (const change of changeSet) {
        if (change.valid == null) previous.null.push(change.id);
        else if (change.valid) previous.true.push(change.id);
        else previous.false.push(change.id);
      }

      const auditLog = txLogRepo.create({
        system: 'LogService',
        subsystem: FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM,
        severity: LogSeverity.INFO,
        message: JSON.stringify({
          accountId,
          valid: dto.valid,
          from: dto.from ?? null,
          to: dto.to ?? null,
          min: dto.min ?? null,
          max: dto.max ?? null,
          reference: dto.reference,
          auditedRows: changeSet.length,
          previous,
        }),
      });
      await txLogRepo.save(auditLog);

      const ids = changeSet.map(({ id }) => id);
      const updated = await txLogRepo.setFinancialLogValidity(dto, ids);
      if (updated !== ids.length)
        this.logger.error(
          `Financial log validity audit/update divergence: audited ${ids.length} rows, actually affected ${updated} rows`,
        );

      return updated;
    });

    this.logger.info(
      `Financial log validity set to ${dto.valid} by account ${accountId}: filters ${JSON.stringify({
        from: dto.from ?? null,
        to: dto.to ?? null,
        min: dto.min ?? null,
        max: dto.max ?? null,
      })}, reference: ${dto.reference}, affected ${affected}`,
    );
    return { affected };
  }

  async getLog(id: number): Promise<Log | undefined> {
    return this.logRepo.findOneBy({ id });
  }

  async maxEntity(system: string, subsystem: string, severity: LogSeverity, valid?: boolean): Promise<Log | undefined> {
    return this.logRepo.findOne({ where: { system, subsystem, severity, valid }, order: { id: 'DESC' } });
  }

  async getFinancialLogs(
    from?: Date,
    dailySample?: boolean,
    to?: Date,
    limit?: number,
    after?: number, // id of the last row of the previous page; NEVER a Date/created value
  ): Promise<Log[]> {
    return this.logRepo.getFinancialLogs(from, dailySample, to, limit, after);
  }

  async getFinancialLogAssetPrices(
    from?: Date,
    to?: Date,
    limit?: number,
    after?: number,
  ): Promise<FinancialLogAssetPrice[]> {
    return this.logRepo.getFinancialLogAssetPrices(from, to, limit, after);
  }

  async getFinancialDashboardLogEntries(
    from?: Date,
    dailySample?: boolean,
    btcAssetId?: number,
  ): Promise<FinancialDashboardLogEntry[]> {
    return this.logRepo.getFinancialDashboardLogEntries(from, dailySample, btcAssetId);
  }

  async getLatestFinancialLog(): Promise<Log | undefined> {
    return this.logRepo.getLatestFinancialLog();
  }

  async getLatestValidFinancialLogs(count: number): Promise<Log[]> {
    return this.logRepo.getLatestValidFinancialLogs(count);
  }

  async getLatestFinancialChangesLog(): Promise<Log | undefined> {
    return this.logRepo.getLatestFinancialChangesLog();
  }

  async getFinancialChangesLogs(from?: Date, dailySample?: boolean): Promise<Log[]> {
    return this.logRepo.getFinancialChangesLogs(from, dailySample);
  }

  async getFinancialLogAt(targetDate: Date, direction: 'before' | 'after'): Promise<Log | undefined> {
    return this.logRepo.getFinancialLogAt(targetDate, direction);
  }

  async getBankLog(batchId: string): Promise<Log> {
    return this.logRepo
      .createQueryBuilder('log')
      .where('subsystem = :subsystem', { subsystem: 'UploadBank' })
      .andWhere('severity = :severity', { severity: LogSeverity.INFO })
      .andWhere('log.message LIKE :message', { message: `%${batchId}%` })
      .getOne();
  }
}
