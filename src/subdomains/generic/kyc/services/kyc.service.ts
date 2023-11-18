import { Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { LessThan } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { KycContentType, KycFileType } from '../dto/kyc-file.dto';
import { KycInfoDto, KycStepDto } from '../dto/kyc-info.dto';
import { KycInfoMapper } from '../dto/kyc-info.mapper';
import { KycResultDto } from '../dto/kyc-result.dto';
import { KycStepMapper } from '../dto/kyc-step.mapper';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName, KycStepStatus, KycStepType, getKycStepIndex } from '../enums/kyc.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { DocumentStorageService } from './integration/document-storage.service';
import { IdentService } from './integration/ident.service';

@Injectable()
export class KycService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly identService: IdentService,
    private readonly storageService: DocumentStorageService,
    private readonly kycStepRepo: KycStepRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async checkIdentSteps(): Promise<void> {
    const allIdentInProgress = await this.kycStepRepo.findBy({
      name: KycStepName.IDENT,
      status: KycStepStatus.IN_PROGRESS,
      created: LessThan(Util.daysBefore(Config.kyc.identFailAfterDays)),
    });

    for (const identStep of allIdentInProgress) {
      identStep.fail();
      await this.kycStepRepo.save(identStep);
    }
  }

  async getInfo(kycHash: string): Promise<KycInfoDto> {
    const user = await this.getUserOrThrow(kycHash);
    return KycInfoMapper.toDto(user);
  }

  async updatePersonalData(kycHash: string, stepId: number): Promise<KycResultDto> {
    const user = await this.getUserOrThrow(kycHash);
    const kycStep = this.getKycStepOrThrow(user, stepId);

    if (kycStep.userData.isDataComplete()) kycStep.complete();
    // TODO: update user data and complete step (if data complete), might be mail or personal data step

    await this.updateProgress(user, false);

    return { done: kycStep.isCompleted() };
  }

  async getFinancialData(kycHash: string, stepId: number): Promise<void> {
    const user = await this.getUserOrThrow(kycHash);
    const kycStep = this.getKycStepOrThrow(user, stepId);

    // TODO: get questions and existing answers
  }

  async updateFinancialData(kycHash: string, stepId: number): Promise<KycResultDto> {
    const user = await this.getUserOrThrow(kycHash);
    const kycStep = this.getKycStepOrThrow(user, stepId);

    // TODO: store financial data and complete step (if data complete)

    await this.updateProgress(user, false);

    return { done: kycStep.isCompleted() };
  }

  async uploadDocument(kycHash: string, stepId: number, document: Express.Multer.File): Promise<KycResultDto> {
    const user = await this.getUserOrThrow(kycHash);
    const kycStep = this.getKycStepOrThrow(user, stepId);

    const url = await this.storageService.uploadFile(
      user.id,
      KycFileType.USER_NOTES,
      document.filename,
      document.buffer,
      document.mimetype as KycContentType,
      {
        document: document.mimetype.toString(),
        creationTime: new Date().toISOString(),
        fileName: document.filename,
      },
    );

    if (url) kycStep.complete();

    await this.updateProgress(user, false);

    return { done: kycStep.isCompleted() };
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
      const nextStep = this.getNextStep(user);

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
    const sequenceNumber = user.getSequenceNumber(stepName, stepType);
    let kycStep: KycStep;
    switch (stepName) {
      case KycStepName.MAIL:
        kycStep = KycStep.create(user, stepName, sequenceNumber);
        if (user.mail !== '') kycStep.complete();
        // TODO: verify, if user can be merged
        return kycStep;

      case KycStepName.PERSONAL_DATA:
        kycStep = KycStep.create(user, stepName, sequenceNumber);
        if (kycStep.userData.isDataComplete()) kycStep.complete();
        return kycStep;

      case KycStepName.IDENT:
        kycStep = KycStep.create(user, stepName, sequenceNumber, stepType);
        const transactionId = `${Config.kyc.transactionPrefix}-${kycStep.id}-${sequenceNumber}`;
        const ident = await this.identService.initiateIdent(user, stepType, transactionId);
        kycStep.sessionId = ident.id;
        // TODO: verify 2FA
        return kycStep;

      case KycStepName.FINANCIAL_DATA:
        return KycStep.create(user, stepName, sequenceNumber);

      case KycStepName.DOCUMENT_UPLOAD:
        return KycStep.create(user, stepName, sequenceNumber, stepType);
    }
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

  getKycStepOrThrow(user: UserData, stepId: number): KycStep {
    const kycStep = user.kycSteps.find((s) => (s.id = stepId));
    if (!kycStep) throw new NotFoundException('Kyc step not found');

    return kycStep;
  }

  async saveUserAndMap(user: UserData): Promise<KycInfoDto> {
    user = await this.userDataService.save(user);

    return KycInfoMapper.toDto(user);
  }
}
