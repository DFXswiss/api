import { Injectable, NotFoundException } from '@nestjs/common';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { CreateKycLogDto } from '../dto/create-kyc-log.dto';
import { UpdateKycLogDto } from '../dto/update-kyc-log.dto';
import { KycLog } from '../entities/kyc-log.entity';
import { KycLogRepository } from '../repositories/kyc-log.repository';

@Injectable()
export class KycLogService {
  constructor(private kycLogRepo: KycLogRepository) {}

  async create(dto: CreateKycLogDto): Promise<KycLog> {
    const entity = this.kycLogRepo.create(dto);

    return this.kycLogRepo.save(entity);
  }

  async update(id: number, dto: UpdateKycLogDto): Promise<KycLog> {
    const entity = await this.kycLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('KycLog not found');

    return this.kycLogRepo.save({ ...entity, ...dto, manualRateTimestamp: new Date() });
  }

  async alreadyExistingLogs(userData: UserData, result: string): Promise<boolean> {
    const entities = await this.kycLogRepo.find({
      where: { userData: { id: userData.id }, result },
      relations: { userData: true },
    });
    return entities.length > 0;
  }
}
