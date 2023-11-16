import { Injectable, NotFoundException } from '@nestjs/common';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { KycInfoDto, KycStepDto } from '../dto/kyc-info.dto';
import { KycInfoMapper } from '../dto/kyc-info.mapper';
import { KycStepMapper } from '../dto/kyc-step.mapper';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName, KycStepType } from '../enums/kyc.enum';
import { IntrumService } from './integration/intrum.service';

@Injectable()
export class KycService {
  constructor(private readonly userDataService: UserDataService, private readonly intrumService: IntrumService) {}

  async getInfo(kycHash: string): Promise<KycInfoDto> {
    const userData = await this.getUserOrThrow(kycHash);
    return KycInfoMapper.toDto(userData);
  }

  // --- STEPPING METHODS --- //
  async getNextStep(kycHash: string): Promise<KycStepDto> {
    const userData = await this.getUserOrThrow(kycHash);

    let step = userData.getPendingStep();
    if (!step) {
      // TODO: create next step
    }

    return KycStepMapper.entityToDto(step);
  }

  async getOrCreateStep(kycHash: string, stepName: KycStepName, stepType?: KycStepType): Promise<KycStepDto> {
    const userData = await this.getUserOrThrow(kycHash);

    let step = userData.getPendingStep(stepName, stepType);
    if (!step) {
      step = await this.initiateStep(userData, stepName, stepType);
      userData.nextStep(step);
    }

    return KycStepMapper.entityToDto(step);
  }

  private async initiateStep(userData: UserData, stepName: KycStepName, stepType?: KycStepType): Promise<KycStep> {
    switch (stepName) {
      case KycStepName.USER_DATA:
        // TODO: create entity
        break;

      case KycStepName.IDENT:
        // TODO: trigger Intrum => create entity
        // TODO: verify 2FA
        // TODO: stepType is required
        break;

      case KycStepName.FINANCIAL:
        // TODO: create entity
        break;

      case KycStepName.DOCUMENT_UPLOAD:
        // TODO: create entity
        // TODO: stepType is required
        break;
    }

    throw new Error('Not implemented');
  }

  // --- HELPER METHODS --- //
  async getUserOrThrow(kycHash: string): Promise<UserData> {
    const userData = await this.userDataService.getUserDataByKycHash(kycHash);
    if (!userData) throw new NotFoundException('User not found');

    return userData;
  }
}
