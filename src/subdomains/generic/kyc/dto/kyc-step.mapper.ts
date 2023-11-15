import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepStatus } from '../enums/kyc.enum';
import { KycService } from '../services/kyc.service';
import { KycStepDto } from './kyc-info.dto';

export class KycStepMapper {
  static entityToDto(kycStep: KycStep): KycStepDto {
    const dto: KycStepDto = {
      name: kycStep.name,
      status: kycStep.status,
      sessionId: kycStep.sessionId,
    };

    return Object.assign(new KycStepDto(), dto);
  }

  static entitiesToDto(userData: UserData): KycStepDto[] {
    const steps = userData.kycSteps.map(KycStepMapper.entityToDto);

    // add open steps
    const naSteps = KycService.getSteps(userData)
      .filter((step) => !steps.some((s) => s.name === step))
      .map((s) => ({ name: s, status: KycStepStatus.NOT_STARTED }));

    return KycService.sortSteps(userData, steps.concat(naSteps));
  }
}
