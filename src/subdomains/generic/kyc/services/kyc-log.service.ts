import { Injectable, NotFoundException } from '@nestjs/common';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycLogType } from '../enums/kyc.enum';
import { KycLogRepository } from '../repositories/kyc-log.repository';

@Injectable()
export class KycLogService {
  constructor(private readonly kycLogRepo: KycLogRepository) {}

  async createMergeLog(user: UserData, log: string): Promise<void> {
    const entity = this.kycLogRepo.create({
      type: KycLogType.MERGE,
      result: log,
      userData: user,
    });

    await this.kycLogRepo.save(entity);
  }

  async updateLogPdfUrl(id: number, url: string): Promise<void> {
    const entity = await this.kycLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('KycLog not found');

    await this.kycLogRepo.update(...entity.setPdfUrl(url));
  }
}
