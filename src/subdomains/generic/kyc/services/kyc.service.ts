import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LessThan } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { IdentAborted, IdentFailed, IdentPending, IdentResultDto, IdentSucceeded } from '../dto/ident-result.dto';
import { KycContentType, KycFileType } from '../dto/kyc-file.dto';
import { KycInfoDto, KycStepDto } from '../dto/kyc-info.dto';
import { KycInfoMapper } from '../dto/kyc-info.mapper';
import { KycResultDto } from '../dto/kyc-result.dto';
import { KycStepMapper } from '../dto/kyc-step.mapper';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName, KycStepStatus, KycStepType } from '../enums/kyc.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { DocumentStorageService } from './integration/document-storage.service';
import { IdentService } from './integration/ident.service';

// TODO:
// - country API
// - update UserData (+ block update when KYC in progress)
// - method for completion (call from UserDataService)
// - custom ident methods (Settings/Wallet, see old KycProcessService)
// - KYC reminders?
// - send user mails (failed, completed, ident?) => see old KycProcessService
// - send support mails (failed)
// - send webhooks

@Injectable()
export class KycService {
  private readonly logger = new DfxLogger(KycService);

  constructor(
    private readonly userDataService: UserDataService,
    private readonly identService: IdentService,
    private readonly storageService: DocumentStorageService,
    private readonly kycStepRepo: KycStepRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async checkIdentSteps(): Promise<void> {
    const expiredIdentSteps = await this.kycStepRepo.find({
      where: {
        name: KycStepName.IDENT,
        status: KycStepStatus.IN_PROGRESS,
        created: LessThan(Util.daysBefore(Config.kyc.identFailAfterDays)),
      },
      relations: { userData: true },
    });

    for (const identStep of expiredIdentSteps) {
      const user = identStep.userData.failStep(identStep);
      await this.userDataService.save(user);
    }
  }

  async getInfo(kycHash: string): Promise<KycInfoDto> {
    const user = await this.getUserOrThrow(kycHash);
    return KycInfoMapper.toDto(user);
  }

  // --- UPDATE METHODS --- //
  async updatePersonalData(kycHash: string, stepId: number): Promise<KycResultDto> {
    let user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    if (user.isDataComplete) user = user.completeStep(kycStep);
    // TODO: update user data and complete step (if data complete), might be mail or personal data step

    await this.updateProgress(user, false);

    return { done: kycStep.isCompleted() };
  }

  async getFinancialData(kycHash: string, stepId: number): Promise<void> {
    const user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    // TODO: get questions and existing answers
  }

  async updateFinancialData(kycHash: string, stepId: number): Promise<KycResultDto> {
    const user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    // TODO: store financial data and complete step (if data complete)

    await this.updateProgress(user, false);

    return { done: kycStep.isCompleted() };
  }

  async updateIdent(dto: IdentResultDto): Promise<void> {
    if (!dto?.identificationprocess?.id) throw new BadRequestException(`Identification process ID is missing`);

    const { id: sessionId, result: sessionStatus } = dto.identificationprocess;
    const result = JSON.stringify(dto);

    const kycStep = await this.kycStepRepo.findOne({
      where: { sessionId },
      relations: { userData: true },
    });

    if (!kycStep) {
      this.logger.error(`Received unmatched ident webhook call: ${result}`);
      return;
    }

    let user = kycStep.userData;

    this.logger.info(`Received ident webhook call for user ${user.id} (${sessionId}): ${sessionStatus}`);

    if (IdentSucceeded(dto)) {
      user = user.completeStep(kycStep, result);
    } else if (IdentPending(dto)) {
      // TODO
      // user = user.stepInReview(kycStep);
    } else if (IdentAborted(dto)) {
      this.logger.info(`Ident cancelled for user ${user.id}: ${sessionStatus}`);
    } else if (IdentFailed(dto)) {
      user = user.failStep(kycStep, result);
    } else {
      this.logger.error(`Unknown ident result for user ${user.id}: ${sessionStatus}`);
    }

    await this.updateProgress(user, false);
  }

  async uploadDocument(kycHash: string, stepId: number, document: Express.Multer.File): Promise<KycResultDto> {
    const user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

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

    if (url) {
      user.completeStep(kycStep, url);
    }

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

    let step = user.getPendingStepWith(stepName, stepType);
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
    const lastStep = user.getLastStep();
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
    const nextSequenceNumber = user.getNextSequenceNumber(stepName, stepType);
    const kycStep = KycStep.create(user, stepName, nextSequenceNumber, stepType);

    switch (stepName) {
      case KycStepName.MAIL:
        // TODO: verify, if user can be merged

        if (user.mail !== '') kycStep.complete();
        break;

      case KycStepName.PERSONAL_DATA:
        if (user.isDataComplete) kycStep.complete();
        break;

      case KycStepName.IDENT:
        // TODO: verify 2FA

        const transactionId = `${Config.kyc.transactionPrefix}-${kycStep.id}-${nextSequenceNumber}`;
        const { id } = await this.identService.initiateIdent(stepType, transactionId);
        kycStep.sessionId = id;
        break;
    }

    return kycStep;
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
