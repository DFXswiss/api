import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { UpdateResult } from 'src/shared/models/entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { FindOptionsRelations } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycLevel, KycStatus } from '../../user/models/user-data/user-data.enum';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { KycNationalityData } from '../dto/input/kyc-data.dto';
import { UpdateKycStepDto } from '../dto/input/update-kyc-step.dto';
import { KycError } from '../dto/kyc-error.enum';
import { KycWebhookTriggerDto } from '../dto/kyc-webhook-trigger.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName } from '../enums/kyc-step-name.enum';
import { KycStepType } from '../enums/kyc.enum';
import { ReviewStatus } from '../enums/review-status.enum';
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

    await this.kycStepRepo.update(...kycStep.update(dto.status, dto.result, dto.comment));

    if (kycStep.isFailed && kycStep.comment)
      await this.kycNotificationService.kycStepFailed(
        kycStep.userData,
        this.kycService.getMailStepName(kycStep.name, kycStep.userData.language.symbol),
        kycStep.name === KycStepName.IDENT
          ? this.kycService.getMailFailedReason(kycStep.comment, kycStep.userData.language.symbol)
          : kycStep.comment,
      );

    switch (kycStep.name) {
      case KycStepName.AUTHORITY:
        if (kycStep.isCompleted)
          await this.kycService.completeReferencedSteps(kycStep.userData, KycStepName.SIGNATORY_POWER);
        break;

      case KycStepName.RESIDENCE_PERMIT:
        if (kycStep.isCompleted)
          await this.kycService.completeReferencedSteps(kycStep.userData, KycStepName.NATIONALITY_DATA);
        break;

      case KycStepName.SOLE_PROPRIETORSHIP_CONFIRMATION:
      case KycStepName.LEGAL_ENTITY:
        if (kycStep.isCompleted) await this.kycService.completeCommercialRegister(kycStep.userData);
        break;

      case KycStepName.IDENT:
        if (kycStep.isCompleted) {
          const nationalityData = kycStep.userData
            .getCompletedStepWith(KycStepName.NATIONALITY_DATA)
            ?.getResult<KycNationalityData>();
          await this.kycService.completeIdent(kycStep, undefined, nationalityData);
        }
        break;

      case KycStepName.DFX_APPROVAL:
        if (kycStep.isCompleted && kycStep.userData.kycLevel < KycLevel.LEVEL_50)
          await this.userDataService.updateUserDataInternal(kycStep.userData, {
            kycLevel: KycLevel.LEVEL_50,
            kycStatus: KycStatus.COMPLETED,
          });
        break;
    }

    if (kycStep.isCompleted) await this.kycService.checkDfxApproval(kycStep);
  }

  async updateKycStepInternal(dto: UpdateResult<KycStep>): Promise<void> {
    await this.kycStepRepo.update(...dto);
  }

  async syncIdentStep(stepId: number): Promise<void> {
    const kycStep = await this.kycStepRepo.findOneBy({ id: stepId });
    if (!kycStep) throw new NotFoundException('KYC step not found');

    await this.kycService.syncIdentStep(kycStep);
  }

  async resetKyc(userData: UserData, comment: KycError): Promise<void> {
    for (const kycStep of userData.kycSteps) {
      if (
        [KycStepName.FINANCIAL_DATA, KycStepName.IDENT, KycStepName.DFX_APPROVAL].includes(kycStep.name) &&
        !kycStep.isFailed &&
        !kycStep.isCanceled
      )
        await this.kycStepRepo.update(kycStep.id, { status: ReviewStatus.CANCELED, comment });
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

    if (kycStep.status === ReviewStatus.FAILED) {
      await this.webhookService.kycFailed(kycStep.userData, dto.reason ?? 'KYC failed');
    } else {
      await this.webhookService.kycChanged(kycStep.userData);
    }
  }
}
