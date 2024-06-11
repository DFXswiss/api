import { Injectable } from '@nestjs/common';
import { Equal } from 'typeorm';
import { CreateLogDto } from './dto/create-log.dto';
import { Log } from './log.entity';
import { LogRepository } from './log.repository';

@Injectable()
export class LogService {
  constructor(private logRepo: LogRepository) {}

  async create(dto: CreateLogDto): Promise<Log> {
    const maxEntity = await this.maxEntity(dto.system, dto.subsystem, dto.severity);
    if (dto.message === maxEntity?.message) return maxEntity;

    const newEntity = this.logRepo.create(dto);
    return this.logRepo.save(newEntity);
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
}
