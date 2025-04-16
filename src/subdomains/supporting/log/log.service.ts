import { Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Brackets, Equal } from 'typeorm';
import { CreateLogDto, LogCleanupSetting, UpdateLogDto } from './dto/create-log.dto';
import { Log, LogSeverity } from './log.entity';
import { LogRepository } from './log.repository';

@Injectable()
export class LogService {
  constructor(private readonly logRepo: LogRepository, private readonly settingService: SettingService) {}

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

  async maxEntity(system: string, subsystem: string, severity: string): Promise<Log | undefined> {
    const { maxId } = await this.logRepo
      .createQueryBuilder()
      .select('max(id) as maxId')
      .where('system = :system', { system })
      .andWhere('subsystem = :subsystem', { subsystem })
      .andWhere('severity = :severity', { severity })
      .getRawOne<{ maxId: number }>();

    return this.logRepo.findOneBy({ id: Equal(maxId) });
  }

  async getBankLogs(batchIds: string[]): Promise<Log[]> {
    const query = this.logRepo
      .createQueryBuilder('log')
      .where('subsystem = UploadBank')
      .andWhere('severity = :severity', { severity: LogSeverity.INFO });

    query.where(
      new Brackets((query) =>
        batchIds.forEach((id, index) => {
          if (index === 0) {
            query.where(`log.message LIKE :${id}`, { id });
          } else {
            query.orWhere(`log.message LIKE :${id}`, { id });
          }
        }),
      ),
    );

    return query.getMany();
  }
}
