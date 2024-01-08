import { Injectable, NotFoundException } from '@nestjs/common';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UpdateKycStepDto } from '../dto/input/update-kyc-step.dto';
import { KycLogType } from '../enums/kyc.enum';
import { KycLogRepository } from '../repositories/kyc-log.repository';
import { KycStepRepository } from '../repositories/kyc-step.repository';

@Injectable()
export class KycAdminService {
  constructor(private readonly kycLogRepo: KycLogRepository, private readonly kycStepRepo: KycStepRepository) {}

  async updateLogPdfUrl(id: number, url: string): Promise<void> {
    const entity = await this.kycLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('KycLog not found');

    await this.kycLogRepo.update(...entity.setPdfUrl(url));
  }

  async updateKycStep(stepId: number, dto: UpdateKycStepDto): Promise<void> {
    const kycStep = await this.kycStepRepo.findOneBy({ id: stepId });
    if (!kycStep) throw new NotFoundException('KYC step not found');

    kycStep.update(dto.status, dto.result);
    await this.kycStepRepo.save(kycStep);
  }

  async createMergeLog(user: UserData, log: string): Promise<void> {
    const entity = this.kycLogRepo.create({
      type: KycLogType.MERGE,
      result: log,
      userData: user,
    });

    await this.kycLogRepo.save(entity);
  }
}
