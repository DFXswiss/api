import { Injectable } from '@nestjs/common';
import { KycLog } from '../entities/kyc-log.entity';
import { KycLogRepository } from '../repositories/kyc-log.repository';

@Injectable()
export class KycLogService {
  constructor(private kycLogRepo: KycLogRepository) {}

  async create(dto: CreateKycLogDto): Promise<KycLog> {
    const entity = this.kycLogRepo.create(dto);

    return this.kycLogRepo.save(entity);
  }
}
