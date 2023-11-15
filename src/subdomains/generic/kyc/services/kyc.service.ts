import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { KycDocuments } from '../../user/services/spider/dto/spider.dto';
import { KycInfoDto, KycStepDto } from '../dto/kyc-info.dto';
import { KycInfoMapper } from '../dto/kyc-info.mapper';
import { KycStepMapper } from '../dto/kyc-step.mapper';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName, KycStepStatus } from '../enums/kyc.enum';
export type Step = KycStep | KycStepDto;

@Injectable()
export class KycService {
  private readonly logger = new DfxLogger(KycService);

  private static readonly firstStep = KycStepName.USER_DATA;
  private static readonly personSteps = [KycStepName.USER_DATA, KycStepName.CHATBOT, KycStepName.ONLINE_ID];
  private static readonly businessSteps = [KycStepName.USER_DATA, KycStepName.CHATBOT, KycStepName.ONLINE_ID];

  private static readonly stepStatusOrder = [
    KycStepStatus.FAILED,
    KycStepStatus.NOT_STARTED,
    KycStepStatus.IN_PROGRESS,
    KycStepStatus.COMPLETED,
  ];
  constructor(private readonly userDataService: UserDataService) {}

  async getKycInfo(kycHash: string): Promise<KycInfoDto> {
    const userData = await this.userDataService.getUserDataByKycHash(kycHash);
    return KycInfoMapper.toDto(userData);
  }

  async getOrCreateKycStep(kycHash: string, kycStepName: KycStepName): Promise<KycStepDto> {
    const userData = await this.userDataService.getUserDataByKycHash(kycHash);

    const user = userData.getPendingStep(kycStepName) ?? userData.nextStep(kycStepName);

    return KycStepMapper.toDto(userData);
  }

  // --- STEPPING HELPER METHODS --- //
  private async updateProgress(userData: UserData, shouldContinue: boolean) {
    if (!userData.hasStepsInProgress) {
      const lastStep = KycService.getLastStep(userData);
      const nextStep =
        lastStep?.status === KycStepStatus.COMPLETED
          ? KycService.getStep(userData, KycService.getStepIndex(userData, lastStep) + 1)
          : lastStep?.name ?? KycService.firstStep;

      if (!nextStep) {
        // no more steps to do
        userData.kycCompleted();
      } else if (shouldContinue) {
        // continue with next step
        userData.nextStep(nextStep);
      }
    }

    return this.userDataService.saveAndMap(userData);
  }

  private async initiateStep(userData: UserData, nextStep: KycStepName): Promise<{ sessionId?: string }> {
    const document = KycDocuments[nextStep];
    if (!document) {
      // no initialization required
      return { sessionId: undefined };
    }
    //TODO INTRUM

    return { sessionId: 'INTRUM' };
  }

  private static getLastStep(user: UserData): KycStep {
    const sortedSteps = KycService.sortSteps(user, user.kycSteps);
    return sortedSteps[sortedSteps.length - 1];
  }

  static getSteps(userData: UserData): KycStepName[] {
    return userData.isPersonal ? this.personSteps : this.businessSteps;
  }

  // sorting
  static sortSteps<T extends Step>(userData: UserData, steps: T[]): T[] {
    return steps.sort((a, b) => {
      const indexA = this.getStepIndex(userData, a);
      const indexB = this.getStepIndex(userData, b);

      if (indexA === indexB) {
        return KycService.getStepStatusIndex(a) - KycService.getStepStatusIndex(b);
      }

      return indexA - indexB;
    });
  }

  private static getStep(userData: UserData, index: number): KycStepName | undefined {
    return KycService.getSteps(userData)[index];
  }

  private static getStepIndex(user: UserData, step: Step): number {
    return KycService.getSteps(user).indexOf(step.name);
  }

  private static getStepStatusIndex(step: Step): number {
    return KycService.stepStatusOrder.indexOf(step.status);
  }
}
