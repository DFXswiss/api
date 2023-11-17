import { Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { KycInfoDto, KycStepDto } from '../dto/kyc-info.dto';
import { KycInfoMapper } from '../dto/kyc-info.mapper';
import { KycResultDto } from '../dto/kyc-result.dto';
import { KycStepMapper } from '../dto/kyc-step.mapper';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName, KycStepType, getKycStepIndex } from '../enums/kyc.enum';
import { IntrumService } from './integration/intrum.service';

// TODO: fail ident steps after 90 days?

@Injectable()
export class KycService {
  constructor(private readonly userDataService: UserDataService, private readonly intrumService: IntrumService) {}

  async getInfo(kycHash: string): Promise<KycInfoDto> {
    const user = await this.getUserOrThrow(kycHash);
    return KycInfoMapper.toDto(user);
  }

  async updatePersonalData(kycHash: string, stepId: number): Promise<KycResultDto> {
    const user = await this.getUserOrThrow(kycHash);

    // TODO: update user data and complete step (if data complete), might be mail or personal data step

    await this.updateProgress(user, false);

    // TODO: check if step complete
    return { done: false };
  }

  async getFinancialData(kycHash: string, stepId: number): Promise<void> {
    const user = await this.getUserOrThrow(kycHash);

    // TODO: get questions and existing answers
  }

  async updateFinancialData(kycHash: string, stepId: number): Promise<KycResultDto> {
    const user = await this.getUserOrThrow(kycHash);

    // TODO: store financial data and complete step (if data complete)

    await this.updateProgress(user, false);

    // TODO: check if step complete
    return { done: false };
  }

  async uploadDocument(kycHash: string, stepId: number): Promise<KycResultDto> {
    const user = await this.getUserOrThrow(kycHash);

    // TODO: store document to storage and complete step

    await this.updateProgress(user, false);

    // TODO: check if step complete
    return { done: false };
  }

  // --- STEPPING METHODS --- //
  async continue(kycHash: string): Promise<KycInfoDto> {
    const user = await this.getUserOrThrow(kycHash);

    return this.updateProgress(user, true);
  }

  async getOrCreateStep(kycHash: string, stepName: KycStepName, stepType?: KycStepType): Promise<KycStepDto> {
    const user = await this.getUserOrThrow(kycHash);

    let step = user.getPendingStep(stepName, stepType);
    if (!step) {
      step = await this.initiateStep(user, stepName, stepType);
      user.nextStep(step);

      await this.userDataService.save(user);
    }

    return KycStepMapper.entityToDto(step);
  }

  private async updateProgress(user: UserData, shouldContinue: boolean): Promise<KycInfoDto> {
    if (!user.hasStepsInProgress) {
      let nextStep = this.getNextStep(user);

      if (!nextStep) {
        // no more steps to do
        user.kycProcessDone();
      } else if (shouldContinue) {
        // continue with next step
        const step = await this.initiateStep(user, nextStep.name, nextStep.type);
        user.nextStep(step);

        // update again (step might already be complete)
        return this.updateProgress(user, shouldContinue);
      }
    }

    return this.saveUserAndMap(user);
  }

  private getNextStep(user: UserData): { name: KycStepName; type?: KycStepType } | undefined {
    const lastStep = KycService.getLastStep(user);
    switch (lastStep) {
      case undefined:
        return { name: KycStepName.MAIL };

      case KycStepName.MAIL:
        return { name: KycStepName.PERSONAL_DATA };

      case KycStepName.PERSONAL_DATA:
        return { name: KycStepName.IDENT, type: KycStepType.AUTO };

      case KycStepName.IDENT:
        return { name: KycStepName.FINANCIAL_DATA };

      default:
        return undefined;
    }
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

  private static getLastStep(user: UserData): KycStepName | undefined {
    return Util.maxObj(
      user.kycSteps.map((s) => ({ name: s.name, index: getKycStepIndex(s.name) })),
      'index',
    )?.name;
  }

  // --- HELPER METHODS --- //
  async getUserOrThrow(kycHash: string): Promise<UserData> {
    const user = await this.userDataService.getUserDataByKycHash(kycHash);
    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async saveUserAndMap(user: UserData): Promise<KycInfoDto> {
    user = await this.userDataService.save(user);

    return KycInfoMapper.toDto(user);
  }
}
