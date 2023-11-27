import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepBase, KycStepDto, KycStepSessionDto } from '../output/kyc-info.dto';

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
      status: kycStep.status,
      sequenceNumber: kycStep.sequenceNumber,
    };
  }
}
