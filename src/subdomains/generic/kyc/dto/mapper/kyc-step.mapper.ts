import { KycStep } from '../../entities/kyc-step.entity';
import { ReviewStatus } from '../../enums/review-status.enum';
import { KycReasonMap } from '../kyc-error.enum';
import {
  KycStepStatus as DtoStatus,
  KycStepBase,
  KycStepDto,
  KycStepReason,
  KycStepSessionDto,
} from '../output/kyc-info.dto';

export class KycStepMapper {
  static toStep(kycStep: KycStep, currentStep?: KycStep): KycStepDto {
    const dto: KycStepDto = {
      ...KycStepMapper.toStepBase(kycStep),
      isCurrent: kycStep.id && kycStep.id === currentStep?.id,
    };

    return Object.assign(new KycStepDto(), dto);
  }

  static toStepSession(kycStep: KycStep): KycStepSessionDto {
    const dto: KycStepSessionDto = {
      ...KycStepMapper.toStepBase(kycStep),
      session: kycStep.sessionInfo,
    };

    return Object.assign(new KycStepSessionDto(), dto);
  }

  static toStepBase(kycStep: KycStep): KycStepBase {
    return {
      name: kycStep.name,
      type: kycStep.type ?? undefined,
      status: this.toStepStatus(kycStep.status),
      reason: this.toStepReason(kycStep),
      sequenceNumber: kycStep.sequenceNumber,
    };
  }

  private static toStepStatus(entityStatus: ReviewStatus): DtoStatus {
    return KycStepMapper.StepMap[entityStatus];
  }

  static toStepReason(kycStep: KycStep): KycStepReason {
    return KycReasonMap[kycStep.comment];
  }

  private static StepMap: Record<ReviewStatus, DtoStatus> = {
    [ReviewStatus.NOT_STARTED]: DtoStatus.NOT_STARTED,
    [ReviewStatus.IN_PROGRESS]: DtoStatus.IN_PROGRESS,
    [ReviewStatus.FINISHED]: DtoStatus.IN_REVIEW,
    [ReviewStatus.EXTERNAL_REVIEW]: DtoStatus.IN_REVIEW,
    [ReviewStatus.INTERNAL_REVIEW]: DtoStatus.IN_REVIEW,
    [ReviewStatus.MANUAL_REVIEW]: DtoStatus.IN_REVIEW,
    [ReviewStatus.PARTIALLY_APPROVED]: DtoStatus.IN_REVIEW,
    [ReviewStatus.PAUSED]: DtoStatus.IN_REVIEW,
    [ReviewStatus.FAILED]: DtoStatus.FAILED,
    [ReviewStatus.CANCELED]: DtoStatus.FAILED,
    [ReviewStatus.IGNORED]: DtoStatus.FAILED,
    [ReviewStatus.COMPLETED]: DtoStatus.COMPLETED,
    [ReviewStatus.OUTDATED]: DtoStatus.OUTDATED,
    [ReviewStatus.DATA_REQUESTED]: DtoStatus.DATA_REQUESTED,
    [ReviewStatus.ON_HOLD]: DtoStatus.ON_HOLD,
  };
}
