import { Injectable } from '@nestjs/common';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { SupportLogDto } from '../dto/support-log.dto';
import { SupportLogRepository } from '../repositories/support-log.repository';

@Injectable()
export class SupportLogService {
  constructor(private readonly supportLogRepo: SupportLogRepository) {}

  async createSupportLog(userData: UserData, dto: SupportLogDto): Promise<void> {
    const entity = this.supportLogRepo.create({
      ...dto,
      userData,
      eventDate: dto.eventDate ?? new Date(),
    });

    await this.supportLogRepo.save(entity);
  }
}
