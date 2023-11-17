import { Injectable, NotFoundException } from '@nestjs/common';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { KycInfoDto, KycStepDto } from '../dto/kyc-info.dto';
import { KycInfoMapper } from '../dto/kyc-info.mapper';
import { KycStepMapper } from '../dto/kyc-step.mapper';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName, KycStepStatus, KycStepType } from '../enums/kyc.enum';
import { IntrumService } from './integration/intrum.service';

@Injectable()
export class KycService {
  constructor(private readonly userDataService: UserDataService, private readonly intrumService: IntrumService) {}

  async getInfo(kycHash: string): Promise<KycInfoDto> {
    const user = await this.getUserOrThrow(kycHash);
    return KycInfoMapper.toDto(user);
  }

  async updatePersonalData(kycHash: string): Promise<void> {
    const user = await this.getUserOrThrow(kycHash);

    throw new Error('Method not implemented.');
  }

  async updateFinancialData(kycHash: string): Promise<void> {
    const user = await this.getUserOrThrow(kycHash);

    throw new Error('Method not implemented.');
  }

  async uploadDocument(kycHash: string): Promise<void> {
    const user = await this.getUserOrThrow(kycHash);

    throw new Error('Method not implemented.');
  }

  // --- STEPPING METHODS --- //
  async getNextStep(kycHash: string): Promise<KycStepDto> {
    const user = await this.getUserOrThrow(kycHash);

    let step = user.getPendingStep();
    while (!step || step.status === KycStepStatus.COMPLETED) {
      const { stepName, stepType } = this.nextStep(user);
      step = await this.initiateStep(user, stepName, stepType);
      user.nextStep(step);
    }

    return KycStepMapper.entityToDto(step);
  }

  nextStep(user: UserData): { stepName: KycStepName; stepType?: KycStepType } {
    // TODO: create next step
    throw new Error('Method not implemented.');
  }

  async getOrCreateStep(kycHash: string, stepName: KycStepName, stepType?: KycStepType): Promise<KycStepDto> {
    const user = await this.getUserOrThrow(kycHash);

    let step = user.getPendingStep(stepName, stepType);
    if (!step) {
      step = await this.initiateStep(user, stepName, stepType);
      user.nextStep(step);
    }

    return KycStepMapper.entityToDto(step);
  }

  private async initiateStep(user: UserData, stepName: KycStepName, stepType?: KycStepType): Promise<KycStep> {
    switch (stepName) {
      case KycStepName.MAIL:
        // TODO: create entity
        // TODO: auto-complete if mail already filled
        // TODO: verify, if user can be merged
        break;

      case KycStepName.PERSONAL_DATA:
        // TODO: create entity
        // TODO: auto-complete if user data already filled
        break;

      case KycStepName.IDENT:
        // TODO: trigger Intrum => create entity
        // TODO: verify 2FA
        // TODO: stepType is required
        break;

      case KycStepName.FINANCIAL_DATA:
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
    const user = await this.userDataService.getUserDataByKycHash(kycHash);
    if (!user) throw new NotFoundException('User not found');

    return user;
  }
}
