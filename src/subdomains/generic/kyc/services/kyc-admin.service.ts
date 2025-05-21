import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { UpdateResult } from 'src/shared/models/entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { FindOptionsRelations } from 'typeorm';
import { KycLevel, KycStatus, UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { UpdateKycStepDto } from '../dto/input/update-kyc-step.dto';
import { KycWebhookTriggerDto } from '../dto/kyc-webhook-trigger.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName } from '../enums/kyc-step-name.enum';
import { KycStepStatus, KycStepType } from '../enums/kyc.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { KycNotificationService } from './kyc-notification.service';
import { KycService } from './kyc.service';

@Injectable()
export class KycAdminService {
  private readonly logger = new DfxLogger(KycAdminService);

  constructor(
    private readonly kycStepRepo: KycStepRepository,
    private readonly webhookService: WebhookService,
    private readonly kycService: KycService,
    private readonly kycNotificationService: KycNotificationService,
    @Inject(forwardRef(() => UserDataService))
    private readonly userDataService: UserDataService,
  ) {}

  async getKycSteps(userDataId: number, relations: FindOptionsRelations<KycStep> = {}): Promise<KycStep[]> {
    return this.kycStepRepo.find({ where: { userData: { id: userDataId } }, relations });
  }

  async updateKycStep(stepId: number, dto: UpdateKycStepDto): Promise<void> {
    const kycStep = await this.kycStepRepo.findOne({
      where: { id: stepId },
      relations: { userData: { bankDatas: true, wallet: true, kycSteps: true } },
    });
    if (!kycStep) throw new NotFoundException('KYC step not found');

    await this.kycStepRepo.update(...kycStep.update(dto.status, dto.result));

    if (kycStep.isCompleted) await this.kycService.dfxApprovalCheck(kycStep);

    switch (kycStep.name) {
      case KycStepName.COMMERCIAL_REGISTER:
        if (kycStep.isCompleted) kycStep.userData = await this.kycService.completeCommercialRegister(kycStep.userData);
        break;

      case KycStepName.IDENT:
        if (kycStep.isCompleted) await this.kycService.completeIdent(kycStep);
        if (kycStep.isFailed)
          await this.kycNotificationService.identFailed(
            kycStep.userData,
            this.kycService.getMailFailedReason(kycStep.comment, kycStep.userData.language.symbol),
          );

        break;

      case KycStepName.DFX_APPROVAL:
        if (kycStep.isCompleted && kycStep.userData.kycLevel < KycLevel.LEVEL_50)
          await this.userDataService.updateUserDataInternal(kycStep.userData, {
            kycLevel: KycLevel.LEVEL_50,
            kycStatus: KycStatus.COMPLETED,
          });
        break;
    }
  }

  async updateKycStepInternal(dto: UpdateResult<KycStep>): Promise<void> {
    await this.kycStepRepo.update(...dto);
  }

  async syncIdentStep(stepId: number): Promise<void> {
    const kycStep = await this.kycStepRepo.findOneBy({ id: stepId });
    if (!kycStep) throw new NotFoundException('KYC step not found');

    await this.kycService.syncIdentStep(kycStep);
  }

  async resetKyc(userData: UserData): Promise<void> {
    for (const kycStep of userData.kycSteps) {
      if ([KycStepName.FINANCIAL_DATA, KycStepName.IDENT].includes(kycStep.name) && !kycStep.isFailed)
        await this.kycStepRepo.update(kycStep.id, { status: KycStepStatus.CANCELED });
    }
  }

  async triggerVideoIdentInternal(userData: UserData): Promise<void> {
    try {
      await this.kycService.getOrCreateStepInternal(userData.kycHash, KycStepName.IDENT, KycStepType.SUMSUB_VIDEO);
    } catch (e) {
      this.logger.error(`Failed to trigger video ident internal for userData ${userData.id}:`, e);
    }
  }

  async triggerWebhook(dto: KycWebhookTriggerDto): Promise<void> {
    const kycStep = await this.kycStepRepo.findOne({
      where: [{ id: dto.kycStepId }, { userData: { id: dto.userDataId } }],
      relations: { userData: true },
      order: { updated: 'DESC' },
    });
    if (!kycStep) throw new NotFoundException('No kycSteps found');

    if (kycStep.status === KycStepStatus.FAILED) {
      await this.webhookService.kycFailed(kycStep.userData, dto.reason ?? 'KYC failed');
    } else {
      await this.webhookService.kycChanged(kycStep.userData);
    }
  }
}
