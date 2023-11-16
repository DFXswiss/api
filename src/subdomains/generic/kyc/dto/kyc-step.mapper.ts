import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName, KycStepStatus } from '../enums/kyc.enum';
import { KycStepDto } from './kyc-info.dto';

export class KycStepMapper {
  static entityToDto(kycStep: KycStep): KycStepDto {
    const dto: KycStepDto = {
      name: kycStep.name,
      type: kycStep.type,
      status: kycStep.status,
      sequenceNumber: kycStep.sequenceNumber,
    };

    return Object.assign(new KycStepDto(), dto);
  }

  static entitiesToDto(userData: UserData): KycStepDto[] {
    const steps = userData.kycSteps.map(KycStepMapper.entityToDto);

    // add open steps
    const openSteps: KycStepDto[] = KycStepMapper.getDefaultSteps()
      .filter((step) => !steps.some((s) => s.name === step))
      .map((s) => ({ name: s, status: KycStepStatus.NOT_STARTED, sequenceNumber: 0 }));

    return KycStepMapper.sortSteps(steps.concat(openSteps));
  }

  // --- HELPER METHODS --- //
  static getDefaultSteps(): KycStepName[] {
    return Object.values(KycStepName);
  }

  static sortSteps(steps: KycStepDto[]): KycStepDto[] {
    return steps.sort((a, b) => {
      const indexA = this.getStepIndex(a);
      const indexB = this.getStepIndex(b);

      if (indexA === indexB) {
        return a.sequenceNumber - b.sequenceNumber;
      }

      return indexA - indexB;
    });
  }

  private static getStepIndex(step: KycStepDto): number {
    return KycStepMapper.getDefaultSteps().indexOf(step.name);
  }
}
