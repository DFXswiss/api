import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { LessThan } from 'typeorm';
import { KycLevel, UserData, UserDataStatus } from '../../user/models/user-data/user-data.entity';
import { MergedPrefix, UserDataService } from '../../user/models/user-data/user-data.service';
import { IdentStatus } from '../dto/ident.dto';
import { IdentResultDto, IdentShortResult, getIdentResult } from '../dto/input/ident-result.dto';
import { KycContactData } from '../dto/input/kyc-contact-data.dto';
import { KycFinancialInData, KycFinancialResponse } from '../dto/input/kyc-financial-in.dto';
import { KycPersonalData } from '../dto/input/kyc-personal-data.dto';
import { KycContentType, KycFileType } from '../dto/kyc-file.dto';
import { KycDataMapper } from '../dto/mapper/kyc-data.mapper';
import { KycInfoMapper } from '../dto/mapper/kyc-info.mapper';
import { KycFinancialOutData } from '../dto/output/kyc-financial-out.dto';
import { KycSessionDto, KycStatusDto } from '../dto/output/kyc-info.dto';
import { MergedDto } from '../dto/output/kyc-merged.dto';
import { KycResultDto } from '../dto/output/kyc-result.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { KycLogType, KycStepName, KycStepStatus, KycStepType } from '../enums/kyc.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { StepLogRepository } from '../repositories/step-log.repository';
import { DocumentStorageService } from './integration/document-storage.service';
import { FinancialService } from './integration/financial.service';
import { IdentService } from './integration/ident.service';
import { KycNotificationService } from './kyc-notification.service';

@Injectable()
export class KycService {
  private readonly logger = new DfxLogger(KycService);

  constructor(
    private readonly userDataService: UserDataService,
    private readonly identService: IdentService,
    private readonly financialService: FinancialService,
    private readonly storageService: DocumentStorageService,
    private readonly kycStepRepo: KycStepRepository,
    private readonly languageService: LanguageService,
    private readonly countryService: CountryService,
    private readonly stepLogRepo: StepLogRepository,
    private readonly kycNotificationService: KycNotificationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async checkIdentSteps(): Promise<void> {
    if (DisabledProcess(Process.KYC)) return;

    const expiredIdentSteps = await this.kycStepRepo.find({
      where: {
        name: KycStepName.IDENT,
        status: KycStepStatus.IN_PROGRESS,
        created: LessThan(Util.daysBefore(Config.kyc.identFailAfterDays - 1)),
      },
      relations: { userData: true },
    });

    for (const identStep of expiredIdentSteps) {
      let user = identStep.userData;
      const step = user.getPendingStepOrThrow(identStep.id);

      user = user.failStep(step);
      await this.userDataService.save(user);

      await this.createStepLog(user, step);
    }
  }

  async getInfo(kycHash: string): Promise<KycStatusDto> {
    const user = await this.getUserOrThrow(kycHash);

    return KycInfoMapper.toDto(user, false);
  }

  async continue(kycHash: string, autoStep: boolean): Promise<KycSessionDto> {
    let user = await this.getUserOrThrow(kycHash);

    user = await this.updateProgress(user, true, autoStep);

    await this.verify2faIfRequired(user);

    return KycInfoMapper.toDto(user, true);
  }

  async getCountries(kycHash: string): Promise<Country[]> {
    const user = await this.getUserOrThrow(kycHash);

    return this.countryService.getCountriesByKycType(user.kycType);
  }

  // --- UPDATE METHODS --- //
  async updateContactData(kycHash: string, stepId: number, data: KycContactData): Promise<KycResultDto> {
    let user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    const { user: updatedUser, isKnownUser } = await this.userDataService.updateUserSettings(user, data, true);
    user = isKnownUser ? updatedUser.failStep(kycStep) : updatedUser.completeStep(kycStep);

    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return { status: kycStep.status };
  }

  async updatePersonalData(kycHash: string, stepId: number, data: KycPersonalData): Promise<KycResultDto> {
    let user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    user = await this.userDataService.updateKycData(user, KycDataMapper.toUserData(data));

    if (user.isDataComplete) user = user.completeStep(kycStep);

    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return { status: kycStep.status };
  }

  async getFinancialData(kycHash: string, stepId: number, lang?: string): Promise<KycFinancialOutData> {
    const user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    await this.verify2fa(user);

    const language = (lang && (await this.languageService.getLanguageBySymbol(lang.toUpperCase()))) ?? user.language;

    const questions = this.financialService.getQuestions(language.symbol.toLowerCase());
    const responses = kycStep.getResult<KycFinancialResponse[]>() ?? [];
    return { questions, responses };
  }

  async updateFinancialData(kycHash: string, stepId: number, data: KycFinancialInData): Promise<KycResultDto> {
    const user = await this.getUserOrThrow(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    await this.verify2fa(user);

    kycStep.setResult(data.responses);

    const complete = this.financialService.isComplete(data.responses);
    if (complete) user.reviewStep(kycStep);

    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return { status: kycStep.status };
  }

  async updateIdent(dto: IdentResultDto): Promise<void> {
    const {
      id: sessionId,
      transactionnumber: transactionId,
      result: sessionStatus,
      reason,
    } = dto.identificationprocess;

    if (!sessionId || !transactionId || !sessionStatus) throw new BadRequestException(`Session data is missing`);

    if (!transactionId.includes(Config.kyc.transactionPrefix)) {
      this.logger.verbose(`Received webhook call for a different system: ${transactionId}`);
      return;
    }

    const transaction = await this.getUserByTransactionOrThrow(transactionId, dto);

    let user = transaction.user;
    const kycStep = user.getStepOrThrow(transaction.stepId);

    this.logger.info(`Received ident webhook call for user ${user.id} (${sessionId}): ${sessionStatus}`);

    switch (getIdentResult(dto)) {
      case IdentShortResult.CANCEL:
        user = user.cancelStep(kycStep, dto);
        break;

      case IdentShortResult.REVIEW:
        user = user.checkStep(kycStep, dto);
        break;

      case IdentShortResult.SUCCESS:
        user = user.reviewStep(kycStep, dto);
        await this.downloadIdentDocuments(user, kycStep);
        break;

      case IdentShortResult.FAIL:
        user = user.failStep(kycStep, dto);
        await this.downloadIdentDocuments(user, kycStep, 'fail/');
        await this.kycNotificationService.identFailed(kycStep, reason);
        break;

      default:
        this.logger.error(`Unknown ident result for user ${user.id}: ${sessionStatus}`);
    }

    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);
  }

  async updateIdentStatus(transactionId: string, status: IdentStatus): Promise<string> {
    const transaction = await this.getUserByTransactionOrThrow(transactionId, status);

    let user = transaction.user;
    const kycStep = user.getStepOrThrow(transaction.stepId);

    if (status === IdentStatus.SUCCESS) {
      user = user.finishStep(kycStep);

      await this.createStepLog(user, kycStep);
      await this.updateProgress(user, false);
    }

    const search = new URLSearchParams({ code: user.kycHash, status: kycStep.status });
    return `${Config.frontend.services}/kyc/redirect?${search.toString()}`;
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

    if (url) user.completeStep(kycStep, url);

    await this.updateProgress(user, false);

    return { status: kycStep.status };
  }

  // --- STEPPING METHODS --- //
  async getOrCreateStep(kycHash: string, stepName: string, stepType?: string): Promise<KycSessionDto> {
    const name = Object.values(KycStepName).find((n) => n.toLowerCase() === stepName.toLowerCase());
    const type = Object.values(KycStepType).find((t) => t.toLowerCase() === stepType?.toLowerCase());
    if (!name) throw new BadRequestException('Invalid step name');

    const user = await this.getUserOrThrow(kycHash);

    let step = user.getPendingStepWith(name, type);
    if (!step) {
      step = await this.initiateStep(user, name, type, true);
      user.nextStep(step);

      await this.userDataService.save(user);
    }

    await this.verify2faIfRequired(user);

    return KycInfoMapper.toDto(user, true, step);
  }

  private async updateProgress(user: UserData, shouldContinue: boolean, autoStep = true, depth = 0): Promise<UserData> {
    if (!user.hasStepsInProgress) {
      const { nextStep, nextLevel } = await this.getNext(user);

      if (nextLevel) {
        user.setKycLevel(nextLevel);
        await this.kycNotificationService.kycChanged(user, nextLevel);
      }

      if (nextStep && shouldContinue && (autoStep || depth === 0)) {
        // continue with next step
        const step = await this.initiateStep(user, nextStep.name, nextStep.type, nextStep.preventDirectEvaluation);
        user.nextStep(step);

        // update again if step is complete
        if (step.isCompleted) return this.updateProgress(user, shouldContinue, autoStep, depth + 1);
      }
    }

    return this.saveUser(user);
  }

  private async getNext(user: UserData): Promise<{
    nextStep: { name: KycStepName; type?: KycStepType; preventDirectEvaluation?: boolean } | undefined;
    nextLevel?: KycLevel;
  }> {
    const lastStep = user.getLastStep();
    if (lastStep?.isInProgress) throw new Error('Step still in progress');

    if (lastStep?.isFailed) {
      // on failure
      switch (lastStep.name) {
        case KycStepName.CONTACT_DATA:
          return { nextStep: { name: KycStepName.CONTACT_DATA, preventDirectEvaluation: true } };

        case KycStepName.IDENT:
          return { nextStep: { name: KycStepName.IDENT, type: await this.userDataService.getIdentMethod(user) } };

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
          return {
            nextStep: {
              name: KycStepName.IDENT,
              type: await this.userDataService.getIdentMethod(user),
            },
            nextLevel: KycLevel.LEVEL_20,
          };

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
        kycStep.transactionId = IdentService.transactionId(user, kycStep);
        kycStep.sessionId = await this.identService.initiateIdent(kycStep);
        break;
    }

    return kycStep;
  }

  // --- HELPER METHODS --- //
  private async createStepLog(user: UserData, kycStep: KycStep): Promise<void> {
    const entity = this.stepLogRepo.create({
      type: KycLogType.KYC_STEP,
      result: kycStep.result,
      userData: user,
      kycStep: kycStep,
      status: kycStep.status,
    });

    await this.stepLogRepo.save(entity);
  }

  private async getUserByTransactionOrThrow(
    transactionId: string,
    data: any,
  ): Promise<{ user: UserData; stepId: number }> {
    const kycStep = await this.kycStepRepo.findOne({ where: { transactionId }, relations: { userData: true } });

    if (!kycStep) {
      this.logger.error(`Received unmatched ident call: ${JSON.stringify(data)}`);
      throw new NotFoundException();
    }

    return { user: kycStep.userData, stepId: kycStep.id };
  }

  private async getUserOrThrow(kycHash: string): Promise<UserData> {
    let user = await this.userDataService.getUserDataByKycHash(kycHash, { users: true });
    if (!user) throw new NotFoundException('User not found');

    if (user.status === UserDataStatus.MERGED) {
      user = await this.getMasterUser(user);
      if (user) {
        const payload: MergedDto = {
          error: 'Conflict',
          message: 'User is merged',
          statusCode: 409,
          switchToCode: user.kycHash,
        };
        throw new ConflictException(payload);
      } else {
        throw new BadRequestException('User is merged');
      }
    }

    return user;
  }

  private async getMasterUser(user: UserData): Promise<UserData | undefined> {
    const masterUserId = +user.firstname.replace(MergedPrefix, '');
    if (!isNaN(masterUserId)) return this.userDataService.getUserData(masterUserId);
  }

  private async saveUser(user: UserData): Promise<UserData> {
    return this.userDataService.save(user);
  }

  private async verify2faIfRequired(user: UserData): Promise<void> {
    const stepsWith2fa = [KycStepName.IDENT, KycStepName.FINANCIAL_DATA];
    if (stepsWith2fa.some((s) => user.getPendingStepWith(s))) {
      await this.verify2fa(user);
    }
  }

  private async verify2fa(_user: UserData): Promise<void> {
    // TODO: verify 2FA < 24h
  }

  private async downloadIdentDocuments(user: UserData, kycStep: KycStep, namePrefix = '') {
    const documents = await this.identService.getDocuments(kycStep);

    for (const { name, content, contentType } of documents) {
      await this.storageService.uploadFile(
        user.id,
        KycFileType.IDENTIFICATION,
        `${namePrefix}${name}`,
        content,
        contentType,
      );
    }
  }
}
