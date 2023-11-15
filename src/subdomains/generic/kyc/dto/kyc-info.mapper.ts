import { KycStepMapper } from 'src/subdomains/generic/kyc/dto/kyc-step.mapper';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycInfoDto } from './kyc-info.dto';

export class KycInfoMapper {
  static toDto(userData: UserData): KycInfoDto {
    const dto: KycInfoDto = {
      kycStatus: userData.kycStatus,
      kycSteps: KycStepMapper.entitiesToDto(userData),
    };

    return Object.assign(new KycInfoDto(), dto);
  }
}
