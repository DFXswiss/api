import { Injectable } from '@nestjs/common';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { KycInfoDto, KycStepDto } from '../dto/kyc-info.dto';
import { KycInfoMapper } from '../dto/kyc-info.mapper';
import { KycStepMapper } from '../dto/kyc-step.mapper';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName } from '../enums/kyc.enum';
import { IntrumService } from './integration/intrum.service';

@Injectable()
export class KycService {
  constructor(private readonly userDataService: UserDataService, private readonly intrumService: IntrumService) {}

  async getInfo(kycHash: string): Promise<KycInfoDto> {
    const userData = await this.userDataService.getUserDataByKycHash(kycHash);
    return KycInfoMapper.toDto(userData);
  }

  // --- STEPPING METHODS --- //

  async getOrCreateStep(kycHash: string, stepName: KycStepName): Promise<KycStepDto> {
    const userData = await this.userDataService.getUserDataByKycHash(kycHash);

    let step = userData.getPendingStep(stepName);
    if (!step) {
      step = await this.initiateStep(userData, stepName);
      userData.nextStep(step);
    }

    return KycStepMapper.entityToDto(step);
  }

  private async initiateStep(userData: UserData, step: KycStepName): Promise<KycStep> {
    switch (step) {
      case KycStepName.USER_DATA:
        // TODO
        break;

      case KycStepName.IDENT:
        // TODO: trigger Intrum
        // TODO: verify 2FA
        break;

      case KycStepName.FINANCIAL:
        // TODO
        break;
    }

    throw new Error('Not implemented');
  }
}
