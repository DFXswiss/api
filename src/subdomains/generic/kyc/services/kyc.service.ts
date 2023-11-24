import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LessThan } from 'typeorm';
import { KycLevel, UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { IdentAborted, IdentFailed, IdentPending, IdentResultDto, IdentSucceeded } from '../dto/input/ident-result.dto';
import { KycContactData } from '../dto/input/kyc-contact-data.dto';
import { KycFinancialInData, KycFinancialResponse } from '../dto/input/kyc-financial-in.dto';
import { KycPersonalData } from '../dto/input/kyc-personal-data.dto';
import { KycContentType, KycFileType } from '../dto/kyc-file.dto';
import { KycDataMapper } from '../dto/mapper/kyc-data.mapper';
import { KycInfoMapper } from '../dto/mapper/kyc-info.mapper';
import { KycStepMapper } from '../dto/mapper/kyc-step.mapper';
import { KycFinancialOutData } from '../dto/output/kyc-financial-out.dto';
import { KycInfoDto, KycStepDto } from '../dto/output/kyc-info.dto';
import { KycResultDto } from '../dto/output/kyc-result.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName, KycStepStatus, KycStepType } from '../enums/kyc.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { DocumentStorageService } from './integration/document-storage.service';
import { FinancialService } from './integration/financial.service';
import { IdentService } from './integration/ident.service';

// TODO:
// - country API
// - custom ident methods (Settings/Wallet, see old KycProcessService)
// - send support mails (failed)
// - send webhooks
// - configure Intrum webhooks
// - add redirect API (configure in ident) + set step to InReview
// - 2FA (before ident/financial)

@Injectable()
export class KycService {
  private readonly logger = new DfxLogger(KycService);

  constructor(
    private readonly userDataService: UserDataService,
    private readonly identService: IdentService,
    private readonly financialService: FinancialService,
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
  async updateContactData(kycHash: string, stepId: number, data: KycContactData): Promise<KycResultDto> {
    let user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    const { user: updatedUser, isKnownUser } = await this.userDataService.updateUserSettings(user, data, true);
    user = isKnownUser ? updatedUser.failStep(kycStep) : updatedUser.completeStep(kycStep);

    await this.updateProgress(user, false);

    return { status: kycStep.status };
  }

  async updatePersonalData(kycHash: string, stepId: number, data: KycPersonalData): Promise<KycResultDto> {
    let user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    user = await this.userDataService.updateKycData(user, KycDataMapper.toUserData(data));

    if (user.isDataComplete) user = user.completeStep(kycStep);

    await this.updateProgress(user, false);

    return { status: kycStep.status };
  }

  async getIdentRedirect(transactionId: string, status: string): Promise<string> {
    const kycStep = await this.kycStepRepo.findOne({ where: { transactionId } });

    if (!kycStep) this.logger.verbose(`Received redirect call for a different system: ${transactionId}`);
    if (status == 'success') {
      kycStep.review();
      await this.kycStepRepo.save(kycStep);
    }

    return `services/iframe-message?status=${kycStep.status}`;
  }

  async getFinancialData(kycHash: string, stepId: number): Promise<KycFinancialOutData> {
    const user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    const questions = this.financialService.getQuestions(user.language.symbol.toLowerCase());
    const responses = kycStep.getResult<KycFinancialResponse[]>() ?? [];
    return { questions, responses };
  }

  async updateFinancialData(kycHash: string, stepId: number, data: KycFinancialInData): Promise<KycResultDto> {
    const user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    kycStep.setResult(data.responses);

    const complete = this.financialService.checkResponses(data.responses);
    if (complete) user.reviewStep(kycStep);

    await this.updateProgress(user, false);

    return { status: kycStep.status };
  }

  async updateIdent(dto: IdentResultDto): Promise<void> {
    const { id: sessionId, transactionnumber: transactionId, result: sessionStatus } = dto.identificationprocess;

    if (!sessionId || !transactionId || !sessionStatus) throw new BadRequestException(`Session data is missing`);

    if (!transactionId.includes(Config.kyc.transactionPrefix)) {
      this.logger.verbose(`Received webhook call for a different system: ${transactionId}`);
      return;
    }

    const kycStep = await this.kycStepRepo.findOne({
      where: { sessionId },
      relations: { userData: true },
    });

    if (!kycStep) {
      this.logger.error(`Received unmatched ident webhook call: ${JSON.stringify(dto)}`);
      return;
    }

    let user = kycStep.userData;

    this.logger.info(`Received ident webhook call for user ${user.id} (${sessionId}): ${sessionStatus}`);

    if (IdentSucceeded(dto)) {
      user = user.reviewStep(kycStep, dto);
      await this.downloadIdentDocuments(user, kycStep);
    } else if (IdentPending(dto)) {
      user = user.reviewStep(kycStep, dto);
    } else if (IdentAborted(dto)) {
      this.logger.info(`Ident cancelled for user ${user.id}: ${sessionStatus}`);
    } else if (IdentFailed(dto)) {
      user = user.failStep(kycStep, dto);
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

    return { status: kycStep.status };
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
      const { nextStep, nextLevel } = this.getNext(user);

      if (nextLevel) user.setKycLevel(nextLevel);

      if (nextStep && shouldContinue) {
        // continue with next step
        const step = await this.initiateStep(user, nextStep.name, nextStep.type, nextStep.preventDirectEvaluation);
        user.nextStep(step);

        // update again if step is complete
        if (step.isCompleted) return this.updateProgress(user, shouldContinue);
      }
    }

    return this.saveUserAndMap(user);
  }

  private getNext(user: UserData): {
    nextStep: { name: KycStepName; type?: KycStepType; preventDirectEvaluation?: boolean } | undefined;
    nextLevel?: KycLevel;
  } {
    const lastStep = user.getLastStep();
    if (lastStep?.isInProgress) throw new Error('Step still in progress');

    if (lastStep?.isFailed) {
      // on failure
      switch (lastStep.name) {
        case KycStepName.CONTACT_DATA:
          return { nextStep: { name: KycStepName.CONTACT_DATA, preventDirectEvaluation: true } };

        default:
          return { nextStep: undefined };
      }
    } else {
      // on success
      switch (lastStep?.name) {
        case undefined:
          return { nextStep: { name: KycStepName.CONTACT_DATA } };

        case KycStepName.CONTACT_DATA:
          return { nextStep: { name: KycStepName.PERSONAL_DATA }, nextLevel: KycLevel.LEVEL_10 };

        case KycStepName.PERSONAL_DATA:
          return { nextStep: { name: KycStepName.IDENT, type: KycStepType.AUTO }, nextLevel: KycLevel.LEVEL_20 };

        case KycStepName.IDENT:
          return { nextStep: { name: KycStepName.FINANCIAL_DATA } };

        default:
          return { nextStep: undefined };
      }
    }
  }

  private async initiateStep(
    user: UserData,
    stepName: KycStepName,
    stepType?: KycStepType,
    preventDirectEvaluation?: boolean,
  ): Promise<KycStep> {
    const nextSequenceNumber = user.getNextSequenceNumber(stepName, stepType);
    const kycStep = KycStep.create(user, stepName, nextSequenceNumber, stepType);

    switch (stepName) {
      case KycStepName.CONTACT_DATA:
        if (user.mail && !preventDirectEvaluation) {
          const isKnownUser = await this.userDataService.isKnownKycUser(user);
          isKnownUser ? kycStep.fail() : kycStep.complete();
        }
        break;

      case KycStepName.PERSONAL_DATA:
        if (user.isDataComplete && !preventDirectEvaluation) kycStep.complete();
        break;

      case KycStepName.IDENT:
        // TODO: verify 2FA
        kycStep.transactionId = this.identService.transactionId(user, kycStep);
        kycStep.sessionId = await this.identService.initiateIdent(user, kycStep);
        break;

      case KycStepName.FINANCIAL_DATA:
        // TODO: verify 2FA
        break;
    }

    return kycStep;
  }

  // --- HELPER METHODS --- //
  async getUserOrThrow(kycHash: string): Promise<UserData> {
    const user = await this.userDataService.getUserDataByKycHash(kycHash, { users: true });
    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async saveUserAndMap(user: UserData): Promise<KycInfoDto> {
    user = await this.userDataService.save(user);

    return KycInfoMapper.toDto(user);
  }

  private async downloadIdentDocuments(user: UserData, kycStep: KycStep) {
    const { pdf, zip } = await this.identService.getDocuments(user, kycStep);

    await this.storageService.uploadFile(
      user.id,
      KycFileType.IDENTIFICATION,
      pdf.name,
      pdf.content,
      KycContentType.PDF,
    );
    await this.storageService.uploadFile(
      user.id,
      KycFileType.IDENTIFICATION,
      zip.name,
      zip.content,
      KycContentType.ZIP,
    );
  }
}
