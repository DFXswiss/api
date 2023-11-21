import { UserData } from '../../../user/models/user-data/user-data.entity';
import { KycStepStatus } from '../../enums/kyc.enum';
import { KycInfoDto } from '../output/kyc-info.dto';
import { KycStepMapper } from './kyc-step.mapper';

export class KycInfoMapper {
  static toDto(userData: UserData): KycInfoDto {
    const kycSteps = KycStepMapper.entitiesToDto(userData);
    const reversedSteps = [...kycSteps].reverse();
    const currentStep =
      reversedSteps.find((s) => s.status === KycStepStatus.IN_PROGRESS) ??
      reversedSteps.find((s) => s.status === KycStepStatus.FAILED);

    const dto: KycInfoDto = {
      kycLevel: userData.kycLevel,
      tradingLimit: userData.tradingLimit,
      kycSteps: kycSteps,
      currentStep,
    };

    return Object.assign(new KycInfoDto(), dto);
  }
}
