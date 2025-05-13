import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepStatus as EntityStatus } from '../../enums/kyc.enum';
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

  private static toStepStatus(entityStatus: EntityStatus): DtoStatus {
    return KycStepMapper.StepMap[entityStatus];
  }

  static toStepReason(kycStep: KycStep): KycStepReason {
    return KycReasonMap[kycStep.comment];
  }

  private static StepMap: Record<EntityStatus, DtoStatus> = {
    [EntityStatus.NOT_STARTED]: DtoStatus.NOT_STARTED,
    [EntityStatus.IN_PROGRESS]: DtoStatus.IN_PROGRESS,
    [EntityStatus.FINISHED]: DtoStatus.IN_REVIEW,
    [EntityStatus.EXTERNAL_REVIEW]: DtoStatus.IN_REVIEW,
    [EntityStatus.INTERNAL_REVIEW]: DtoStatus.IN_REVIEW,
    [EntityStatus.MANUAL_REVIEW]: DtoStatus.IN_REVIEW,
    [EntityStatus.PARTIALLY_APPROVED]: DtoStatus.IN_REVIEW,
    [EntityStatus.PAUSED]: DtoStatus.IN_REVIEW,
    [EntityStatus.FAILED]: DtoStatus.FAILED,
    [EntityStatus.CANCELED]: DtoStatus.FAILED,
    [EntityStatus.IGNORED]: DtoStatus.FAILED,
    [EntityStatus.COMPLETED]: DtoStatus.COMPLETED,
    [EntityStatus.OUTDATED]: DtoStatus.OUTDATED,
    [EntityStatus.DATA_REQUESTED]: DtoStatus.DATA_REQUESTED,
    [EntityStatus.ON_HOLD]: DtoStatus.ON_HOLD,
  };
}
