import { Injectable } from '@nestjs/common';
import { CreateLogDto } from './dto/create-log.dto';
import { Log } from './log.entity';
import { LogRepository } from './log.repository';

@Injectable()
export class LogService {
  constructor(private logRepo: LogRepository) {}

  async create(dto: CreateLogDto): Promise<Log> {
    const entity = this.logRepo.create(dto);

    return await this.logRepo.save(entity);
  }
}
