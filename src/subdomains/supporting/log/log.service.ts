import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { CreateLogDto, LogCleanupSetting, UpdateLogDto } from './dto/create-log.dto';
import { SetFinancialLogValidityDto } from './dto/set-financial-log-validity.dto';
import { Log, LogSeverity } from './log.entity';
import { LogRepository } from './log.repository';

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
    const maxEntity = await this.maxEntity(dto.system, dto.subsystem, dto.severity);
    if (dto.message === maxEntity?.message && dto.valid === maxEntity?.valid && dto.category === maxEntity?.category)
      return maxEntity;

    const newEntity = this.logRepo.create(dto);
    return this.logRepo.save(newEntity);
  }

  async update(id: number, dto: UpdateLogDto): Promise<Log> {
    const log = await this.logRepo.findOneBy({ id });
    if (!log) throw new NotFoundException('Log not found');

    return this.logRepo.save({ ...log, ...dto });
  }

  async setFinancialLogValidity(accountId: number, dto: SetFinancialLogValidityDto): Promise<{ affected: number }> {
    if (dto.from == null && dto.to == null && dto.min == null && dto.max == null)
      throw new BadRequestException('At least one filter (from, to, min or max) is required');
    if (dto.from && dto.to && dto.from > dto.to) throw new BadRequestException('from must not be after to');
    if (dto.min != null && dto.max != null && dto.min >= dto.max)
      throw new BadRequestException('min must be smaller than max');

    const changeSet = await this.logRepo.getFinancialLogValidityChangeSet(dto);
    if (!changeSet.length) return { affected: 0 };

    const previous = { true: [] as number[], false: [] as number[], null: [] as number[] };
    for (const change of changeSet) {
      if (change.valid == null) previous.null.push(change.id);
      else if (change.valid) previous.true.push(change.id);
      else previous.false.push(change.id);
    }

    const auditLog = this.logRepo.create({
      system: 'LogService',
      subsystem: 'FinancialLogValidityAudit',
      severity: LogSeverity.INFO,
      message: JSON.stringify({
        accountId,
        valid: dto.valid,
        from: dto.from ?? null,
        to: dto.to ?? null,
        min: dto.min ?? null,
        max: dto.max ?? null,
        reference: dto.reference,
        affected: changeSet.length,
        previous,
      }),
    });
    await this.logRepo.save(auditLog);

    const affected = await this.logRepo.setFinancialLogValidity(dto);
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

  async getFinancialLogs(from?: Date, dailySample?: boolean): Promise<Log[]> {
    return this.logRepo.getFinancialLogs(from, dailySample);
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
