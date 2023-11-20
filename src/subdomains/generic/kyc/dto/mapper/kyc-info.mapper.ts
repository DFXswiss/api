import { UserData } from '../../../user/models/user-data/user-data.entity';
import { KycInfoDto } from '../output/kyc-info.dto';
import { KycStepMapper } from './kyc-step.mapper';

export class KycInfoMapper {
  static toDto(userData: UserData): KycInfoDto {
    const dto: KycInfoDto = {
      kycStatus: userData.kycStatusNew,
      tradingLimit: userData.tradingLimit,
      kycSteps: KycStepMapper.entitiesToDto(userData),
      currentStep: KycStepMapper.entityToDto(userData.getPendingStepWith()),
    };

    return Object.assign(new KycInfoDto(), dto);
  }
}
