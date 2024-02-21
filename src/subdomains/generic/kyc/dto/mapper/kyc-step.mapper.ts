import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepStatus as EntityStatus } from '../../enums/kyc.enum';
import { KycStepStatus as DtoStatus, KycStepBase, KycStepDto, KycStepSessionDto } from '../output/kyc-info.dto';

export class KycStepMapper {
  static toStep(kycStep: KycStep, currentStep?: KycStep): KycStepDto {
    const dto: KycStepDto = {
      ...KycStepMapper.toBase(kycStep),
      isCurrent: kycStep.id && kycStep.id === currentStep?.id,
    };

    return Object.assign(new KycStepDto(), dto);
  }

  static toStepSession(kycStep: KycStep): KycStepSessionDto {
    const dto: KycStepSessionDto = {
      ...KycStepMapper.toBase(kycStep),
      session: kycStep.sessionInfo,
    };

    return Object.assign(new KycStepSessionDto(), dto);
  }

  private static toBase(kycStep: KycStep): KycStepBase {
    return {
      name: kycStep.name,
      type: kycStep.type ?? undefined,
      status: KycStepMapper.StepMap[kycStep.status],
      sequenceNumber: kycStep.sequenceNumber,
    };
  }

  private static StepMap: Record<EntityStatus, DtoStatus> = {
    [EntityStatus.NOT_STARTED]: DtoStatus.NOT_STARTED,
    [EntityStatus.IN_PROGRESS]: DtoStatus.IN_PROGRESS,
    [EntityStatus.FINISHED]: DtoStatus.IN_REVIEW,
    [EntityStatus.CHECK_PENDING]: DtoStatus.IN_REVIEW,
    [EntityStatus.IN_REVIEW]: DtoStatus.IN_REVIEW,
    [EntityStatus.FAILED]: DtoStatus.FAILED,
    [EntityStatus.COMPLETED]: DtoStatus.COMPLETED,
    [EntityStatus.CANCELED]: DtoStatus.FAILED,
    [EntityStatus.OUTDATED]: DtoStatus.OUTDATED,
  };
}
