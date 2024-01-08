import { Injectable, NotFoundException } from '@nestjs/common';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { UpdateKycStepDto } from '../dto/input/update-kyc-step.dto';
import { KycWebhookTriggerDto } from '../dto/kyc-webhook-trigger.dto';
import { KycStepStatus } from '../enums/kyc.enum';
import { KycLogRepository } from '../repositories/kyc-log.repository';
import { KycStepRepository } from '../repositories/kyc-step.repository';

@Injectable()
export class KycAdminService {
  constructor(
    private readonly kycLogRepo: KycLogRepository,
    private readonly kycStepRepo: KycStepRepository,
    private readonly webhookService: WebhookService,
  ) {}

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

  async triggerWebhook(dto: KycWebhookTriggerDto): Promise<void> {
    const kycStep = await this.kycStepRepo.findOne({
      where: [{ id: dto.kycStepId }, { userData: { id: dto.userDataId } }],
      relations: { userData: true },
    });
    if (!kycStep) throw new NotFoundException('No kycSteps found');

    if (kycStep.status === KycStepStatus.FAILED) {
      await this.webhookService.kycFailed(kycStep.userData, dto.reason ?? 'KYC failed');
    } else {
      await this.webhookService.kycChanged(kycStep.userData);
    }
  }
}
