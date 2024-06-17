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
import { AccountMergeService } from '../../user/models/account-merge/account-merge.service';
import { BankDataType } from '../../user/models/bank-data/bank-data.entity';
import { BankDataService } from '../../user/models/bank-data/bank-data.service';
import { KycLevel, UserData, UserDataStatus } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { WalletService } from '../../user/models/wallet/wallet.service';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { IdentStatus } from '../dto/ident.dto';
import { IdentResultDto, IdentShortResult, getIdentReason, getIdentResult } from '../dto/input/ident-result.dto';
import { KycContactData, KycPersonalData } from '../dto/input/kyc-data.dto';
import { KycFinancialInData, KycFinancialResponse } from '../dto/input/kyc-financial-in.dto';
import { ContentType, FileType } from '../dto/kyc-file.dto';
import { KycDataMapper } from '../dto/mapper/kyc-data.mapper';
import { KycInfoMapper } from '../dto/mapper/kyc-info.mapper';
import { KycFinancialOutData } from '../dto/output/kyc-financial-out.dto';
import { KycLevelDto, KycSessionDto } from '../dto/output/kyc-info.dto';
import { KycResultDto } from '../dto/output/kyc-result.dto';
import { KycStep } from '../entities/kyc-step.entity';
import {
  KycLogType,
  KycStepName,
  KycStepStatus,
  KycStepType,
  getIdentificationType,
  requiredKycSteps,
} from '../enums/kyc.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { StepLogRepository } from '../repositories/step-log.repository';
import { DocumentStorageService } from './integration/document-storage.service';
import { FinancialService } from './integration/financial.service';
import { IdentService } from './integration/ident.service';
import { KycNotificationService } from './kyc-notification.service';
import { TfaService } from './tfa.service';

export enum IdentCheckError {
  USER_DATA_MERGED = 'UserDataMerged',
  USER_DATA_BLOCKED = 'UserDataBlocked',
  FIRST_NAME_NOT_MATCHING = 'FirstNameNotMatching',
  LAST_NAME_NOT_MATCHING = 'LastNameNotMatching',
  INVALID_DOCUMENT_TYPE = 'InvalidDocumentType',
  IDENTIFICATION_NUMBER_MISSING = 'IdentificationNumberMissing',
  INVALID_RESULT = 'InvalidResult',
  VERIFIED_NAME_MISSING = 'VerifiedNameMissing',
  FIRST_NAME_NOT_MATCHING_VERIFIED_NAME = 'FirstNameNotMatchingVerifiedName',
  LAST_NAME_NOT_MATCHING_VERIFIED_NAME = 'LastNameNotMatchingVerifiedName',
}

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
    private readonly tfaService: TfaService,
    private readonly kycNotificationService: KycNotificationService,
    private readonly bankDataService: BankDataService,
    private readonly walletService: WalletService,
    private readonly accountMergeService: AccountMergeService,
    private readonly webhookService: WebhookService,
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

      await this.kycNotificationService.identFailed(user, 'Identification session has expired');
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async reviewIdentSteps(): Promise<void> {
    if (DisabledProcess(Process.AUTO_IDENT_KYC)) return;

    const entities = await this.kycStepRepo.find({
      where: { name: KycStepName.IDENT, status: KycStepStatus.INTERNAL_REVIEW },
      relations: { userData: true },
    });

    for (const entity of entities) {
      try {
        const result = entity.getResult<IdentResultDto>();
        const errors = this.getIdentCheckErrors(entity, result);

        entity.comment = errors.join(';');

        if (errors.includes(IdentCheckError.USER_DATA_BLOCKED) || errors.includes(IdentCheckError.USER_DATA_MERGED)) {
          entity.ignored();
        } else if (errors.includes(IdentCheckError.VERIFIED_NAME_MISSING) && errors.length === 1) {
          entity.userData.verifiedName = `${entity.userData.firstname} ${entity.userData.surname}`;
          entity.complete();
        } else if (errors.length === 0) {
          entity.complete();
        } else {
          entity.manualReview();
        }

        await this.createStepLog(entity.userData, entity);
        await this.kycStepRepo.save(entity);
        if (entity.isCompleted) {
          entity.userData = await this.completeIdent(result, entity.userData);

          if (entity.isValidCreatingBankData && !DisabledProcess(Process.AUTO_CREATE_BANK_DATA))
            await this.bankDataService.createBankData(entity.userData, {
              name: entity.userName,
              iban: `Ident${entity.identDocumentId}`,
              type: BankDataType.IDENT,
            });
        }
      } catch (e) {
        this.logger.error(`Failed to auto review ident step ${entity.id}:`, e);
      }
    }
  }

  async getInfo(kycHash: string): Promise<KycLevelDto> {
    const user = await this.getUser(kycHash);
    await this.verifyUserDuplication(user);

    return this.toDto(user, false);
  }

  async continue(kycHash: string, ip: string, autoStep: boolean): Promise<KycSessionDto> {
    return Util.retry(
      () => this.tryContinue(kycHash, ip, autoStep),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    );
  }

  private async tryContinue(kycHash: string, ip: string, autoStep: boolean): Promise<KycSessionDto> {
    let user = await this.getUser(kycHash);
    await this.verifyUserDuplication(user);

    user = await this.updateProgress(user, true, autoStep);

    await this.verify2faIfRequired(user, ip);

    return this.toDto(user, true);
  }

  private async verifyUserDuplication(user: UserData) {
    if (user.hasCompletedStep(KycStepName.CONTACT_DATA) && user.kycLevel < KycLevel.LEVEL_50) {
      const isKnownUser = await this.userDataService.isKnownKycUser(user);
      if (isKnownUser) throw new ConflictException('Account already exists');
    }
  }

  async getCountries(kycHash: string): Promise<Country[]> {
    const user = await this.getUser(kycHash);

    return this.countryService.getCountriesByKycType(user.kycType);
  }

  async addKycClient(kycHash: string, walletName: string): Promise<void> {
    const wallet = await this.walletService.getByIdOrName(undefined, walletName);
    if (!wallet) throw new NotFoundException('KYC client not found');
    if (!wallet.isKycClient) throw new BadRequestException('Wallet is not a kyc client');

    const userData = await this.getUser(kycHash);
    if (!userData) throw new NotFoundException('User data not found');

    await this.userDataService.addKycClient(userData, wallet.id);

    if (userData.kycLevel > KycLevel.LEVEL_0) await this.webhookService.kycChanged(userData);
  }

  async removeKycClient(kycHash: string, walletName: string): Promise<void> {
    const wallet = await this.walletService.getByIdOrName(undefined, walletName);
    if (!wallet) throw new NotFoundException('KYC client not found');

    const userData = await this.getUser(kycHash);
    if (!userData) throw new NotFoundException('User data not found');

    await this.userDataService.removeKycClient(userData, wallet.id);
  }

  // --- UPDATE METHODS --- //
  async updateContactData(kycHash: string, stepId: number, data: KycContactData): Promise<KycResultDto> {
    let user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    const { user: updatedUser, isKnownUser } = await this.userDataService.updateUserSettings(user, data, true);
    user = isKnownUser ? updatedUser.failStep(kycStep, data) : updatedUser.completeStep(kycStep, data);

    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return { status: kycStep.status };
  }

  async updatePersonalData(kycHash: string, stepId: number, data: KycPersonalData): Promise<KycResultDto> {
    let user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    user = await this.userDataService.updateKycData(user, KycDataMapper.toUserData(data));

    if (user.isDataComplete) {
      user = user.completeStep(kycStep, data);
      await this.createStepLog(user, kycStep);
    }

    await this.updateProgress(user, false);

    return { status: kycStep.status };
  }

  async getFinancialData(kycHash: string, ip: string, stepId: number, lang?: string): Promise<KycFinancialOutData> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    await this.verify2fa(user, ip);

    const language = (lang && (await this.languageService.getLanguageBySymbol(lang.toUpperCase()))) ?? user.language;

    const questions = this.financialService.getQuestions(language.symbol.toLowerCase());
    const responses = kycStep.getResult<KycFinancialResponse[]>() ?? [];
    return { questions, responses };
  }

  async updateFinancialData(
    kycHash: string,
    ip: string,
    stepId: number,
    data: KycFinancialInData,
  ): Promise<KycResultDto> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    await this.verify2fa(user, ip);

    kycStep.setResult(data.responses);

    const complete = this.financialService.isComplete(data.responses);
    if (complete) {
      user.internalReviewStep(kycStep);
      await this.createStepLog(user, kycStep);
    }

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
        user = user.pauseStep(kycStep, dto);
        await this.kycNotificationService.identFailed(user, getIdentReason(reason));
        break;

      case IdentShortResult.ABORT:
        user = user.pauseStep(kycStep, dto);
        break;

      case IdentShortResult.REVIEW:
        user = user.externalReviewStep(kycStep, dto);
        break;

      case IdentShortResult.SUCCESS:
        user = user.internalReviewStep(kycStep, dto);
        await this.downloadIdentDocuments(user, kycStep);
        break;

      case IdentShortResult.FAIL:
        user = user.failStep(kycStep, dto);
        await this.downloadIdentDocuments(user, kycStep, 'fail/');
        await this.kycNotificationService.identFailed(user, getIdentReason(reason));
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

      await this.updateProgress(user, false);
    }

    const search = new URLSearchParams({ code: user.kycHash, status: kycStep.status });
    return `${Config.frontend.services}/kyc/redirect?${search.toString()}`;
  }

  async uploadDocument(kycHash: string, stepId: number, document: Express.Multer.File): Promise<KycResultDto> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    const url = await this.storageService.uploadFile(
      user.id,
      FileType.USER_NOTES,
      document.filename,
      document.buffer,
      document.mimetype as ContentType,
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
  async getOrCreateStep(
    kycHash: string,
    ip: string,
    stepName: string,
    stepType?: string,
    sequence?: number,
  ): Promise<KycSessionDto> {
    const name = Object.values(KycStepName).find((n) => n.toLowerCase() === stepName.toLowerCase());
    const type = Object.values(KycStepType).find((t) => t.toLowerCase() === stepType?.toLowerCase());
    if (!name) throw new BadRequestException('Invalid step name');

    const user = await this.getUser(kycHash);

    let step =
      sequence != null
        ? user.getStepsWith(name, type, sequence)[0]
        : user.getStepsWith(name, type).find((s) => s.isInProgress || s.isInReview);
    if (!step) {
      step = await this.initiateStep(user, name, type, true);
      user.nextStep(step);

      await this.userDataService.save(user);
    }

    await this.verify2faIfRequired(user, ip);

    return this.toDto(user, true, step);
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
    const missingSteps = requiredKycSteps().filter((rs) => !user.hasDoneStep(rs));

    const nextStep = missingSteps[0];

    const lastTry = nextStep && Util.maxObj(user.getStepsWith(nextStep), 'sequenceNumber');
    const preventDirectEvaluation = lastTry != null;

    switch (nextStep) {
      case KycStepName.CONTACT_DATA:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.PERSONAL_DATA:
        return { nextStep: { name: nextStep, preventDirectEvaluation }, nextLevel: KycLevel.LEVEL_10 };

      case KycStepName.IDENT:
        return {
          nextStep: {
            name: nextStep,
            type: await this.userDataService.getIdentMethod(user),
            preventDirectEvaluation,
          },
          nextLevel: KycLevel.LEVEL_20,
        };

      case KycStepName.FINANCIAL_DATA:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      default:
        return { nextStep: undefined };
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

    // cancel a pending step with same type
    const pendingStep = user.getPendingStepWith(stepName);
    if (pendingStep) user.cancelStep(pendingStep);

    switch (stepName) {
      case KycStepName.CONTACT_DATA:
        if (user.mail && !preventDirectEvaluation) {
          const result = { mail: user.mail };
          const isKnownUser = await this.userDataService.isKnownKycUser(user);
          isKnownUser ? kycStep.fail(result) : kycStep.complete(result);
        }
        break;

      case KycStepName.PERSONAL_DATA: {
        const result = user.requiredKycFields.reduce((prev, curr) => ({ ...prev, [curr]: user[curr] }), {});
        if (user.isDataComplete && !preventDirectEvaluation) kycStep.complete(result);
        break;
      }

      case KycStepName.IDENT:
        kycStep.transactionId = IdentService.transactionId(user, kycStep);
        kycStep.sessionId = await this.identService.initiateIdent(user, kycStep);

        if (!user.getStepsWith(KycStepName.IDENT).length) await this.kycNotificationService.sendIdentStartedMail(user);
        break;
    }

    return kycStep;
  }

  // --- HELPER METHODS --- //

  private async completeIdent(result: IdentResultDto, userData: UserData): Promise<UserData> {
    if (
      result.userdata?.birthday?.value &&
      result.userdata?.nationality?.value &&
      getIdentificationType(result.identificationprocess?.companyid) &&
      result.identificationdocument?.type?.value &&
      result.identificationdocument?.number?.value
    ) {
      const nationality = await this.countryService.getCountryWithSymbol(result.userdata.nationality.value);
      const existing = await this.userDataService.getUserDataByIdentDoc(result.identificationdocument.number.value);

      if (existing) {
        await this.accountMergeService.sendMergeRequest(existing, userData);

        return userData;
      } else if (nationality) {
        return this.userDataService.updateUserDataInternal(userData, {
          kycLevel: KycLevel.LEVEL_30,
          birthday: new Date(result.userdata.birthday.value),
          nationality,
          identificationType: getIdentificationType(result.identificationprocess.companyid),
          identDocumentType: result.identificationdocument.type.value,
          identDocumentId: result.identificationdocument.number.value,
        });
      }
    }

    this.logger.error(`Missing ident data for userData ${userData.id}`);

    return userData;
  }

  private getIdentCheckErrors(entity: KycStep, result: IdentResultDto): IdentCheckError[] {
    const errors = [];

    if (entity.userData.status === UserDataStatus.MERGED) errors.push(IdentCheckError.USER_DATA_MERGED);
    if (entity.userData.status === UserDataStatus.BLOCKED) errors.push(IdentCheckError.USER_DATA_BLOCKED);

    if (!Util.isSameName(entity.userData.firstname, result.userdata?.firstname?.value))
      errors.push(IdentCheckError.FIRST_NAME_NOT_MATCHING);
    if (
      !Util.isSameName(entity.userData.surname, result.userdata?.lastname?.value) &&
      !Util.isSameName(entity.userData.surname, result.userdata?.birthname?.value)
    )
      errors.push(IdentCheckError.LAST_NAME_NOT_MATCHING);

    if (!['IDCARD', 'PASSPORT'].includes(result.identificationdocument?.type?.value))
      errors.push(IdentCheckError.INVALID_DOCUMENT_TYPE);

    if (!result.identificationdocument?.number) errors.push(IdentCheckError.IDENTIFICATION_NUMBER_MISSING);

    if (!['SUCCESS_DATA_CHANGED', 'SUCCESS'].includes(result.identificationprocess?.result))
      errors.push(IdentCheckError.INVALID_RESULT);

    if (!entity.userData.verifiedName && entity.userData.status === UserDataStatus.ACTIVE) {
      errors.push(IdentCheckError.VERIFIED_NAME_MISSING);
    } else if (entity.userData.verifiedName) {
      if (!Util.includesSameName(entity.userData.verifiedName, entity.userData.firstname))
        errors.push(IdentCheckError.FIRST_NAME_NOT_MATCHING_VERIFIED_NAME);
      if (!Util.includesSameName(entity.userData.verifiedName, entity.userData.surname))
        errors.push(IdentCheckError.LAST_NAME_NOT_MATCHING_VERIFIED_NAME);
    }

    return errors;
  }

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

  private async toDto(
    user: UserData,
    withSession: boolean,
    currentStep?: KycStep,
  ): Promise<KycLevelDto | KycSessionDto> {
    const kycClients = await this.walletService.getKycClients();

    return KycInfoMapper.toDto(user, withSession, kycClients, currentStep);
  }

  private async getUser(kycHash: string): Promise<UserData> {
    return this.userDataService.getByKycHashOrThrow(kycHash, { users: true });
  }

  private async getUserByTransactionOrThrow(
    transactionId: string,
    data: any,
  ): Promise<{ user: UserData; stepId: number }> {
    const kycStep = await this.kycStepRepo.findOne({
      where: { transactionId },
      relations: { userData: true },
    });

    if (!kycStep) {
      this.logger.error(`Received unmatched ident call: ${JSON.stringify(data)}`);
      throw new NotFoundException();
    }

    return { user: await this.getUser(kycStep.userData.kycHash), stepId: kycStep.id };
  }

  private async saveUser(user: UserData): Promise<UserData> {
    try {
      return await this.userDataService.save(user);
    } catch (e) {
      if (['value NULL', 'userDataId', 'kyc_step'].every((i) => e.message?.includes(i))) {
        // reload the KYC steps
        const steps = await this.kycStepRepo.findBy({ userData: { id: user.id } });
        user.kycSteps.push(...steps.filter((s1) => !user.kycSteps.find((s2) => s1.id === s2.id)));

        return this.userDataService.save(user);
      }

      throw e;
    }
  }

  private async verify2faIfRequired(user: UserData, ip: string): Promise<void> {
    const stepsWith2fa = [KycStepName.IDENT, KycStepName.FINANCIAL_DATA];
    if (stepsWith2fa.some((s) => user.getPendingStepWith(s))) {
      await this.verify2fa(user, ip);
    }
  }

  private async verify2fa(user: UserData, ip: string): Promise<void> {
    await this.tfaService.checkVerification(user, ip);
  }

  private async downloadIdentDocuments(user: UserData, kycStep: KycStep, namePrefix = '') {
    const documents = await this.identService.getDocuments(kycStep);

    for (const { name, content, contentType } of documents) {
      await this.storageService.uploadFile(
        user.id,
        FileType.IDENTIFICATION,
        `${namePrefix}${name}`,
        content,
        contentType,
      );
    }
  }
}
