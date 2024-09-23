import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { IEntity } from 'src/shared/models/entity';
import { LanguageService } from 'src/shared/models/language/language.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { LessThan, Not } from 'typeorm';
import { AccountMergeService } from '../../user/models/account-merge/account-merge.service';
import { BankDataType } from '../../user/models/bank-data/bank-data.entity';
import { BankDataService } from '../../user/models/bank-data/bank-data.service';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import {
  KycIdentificationType,
  KycLevel,
  UserData,
  UserDataStatus,
} from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { WalletService } from '../../user/models/wallet/wallet.service';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { IdentCheckError } from '../dto/ident-check-error.enum';
import { IdentStatus } from '../dto/ident.dto';
import {
  IdentReason,
  IdentResultDto,
  IdentShortResult,
  getIdentReason,
  getIdentResult,
} from '../dto/input/ident-result.dto';
import { KycContactData, KycFileData, KycPersonalData } from '../dto/input/kyc-data.dto';
import { KycFinancialInData, KycFinancialResponse } from '../dto/input/kyc-financial-in.dto';
import { ContentType, FileType } from '../dto/kyc-file.dto';
import { KycResultData } from '../dto/kyc-result-data.dto';
import { KycDataMapper } from '../dto/mapper/kyc-data.mapper';
import { KycInfoMapper } from '../dto/mapper/kyc-info.mapper';
import { KycStepMapper } from '../dto/mapper/kyc-step.mapper';
import { KycFinancialOutData } from '../dto/output/kyc-financial-out.dto';
import { KycLevelDto, KycSessionDto } from '../dto/output/kyc-info.dto';
import { KycResultDto } from '../dto/output/kyc-result.dto';
import { SumsubResult, WebhookResult, getSumsubResult } from '../dto/sum-sub.dto';
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
import { FinancialService } from './integration/financial.service';
import { IdentService } from './integration/ident.service';
import { KycDocumentService } from './integration/kyc-document.service';
import { SumsubService } from './integration/sum-sub.service';
import { KycNotificationService } from './kyc-notification.service';
import { TfaService } from './tfa.service';

@Injectable()
export class KycService {
  private readonly logger = new DfxLogger(KycService);

  constructor(
    @Inject(forwardRef(() => UserDataService)) private readonly userDataService: UserDataService,
    private readonly identService: IdentService,
    private readonly financialService: FinancialService,
    private readonly documentService: KycDocumentService,
    private readonly kycStepRepo: KycStepRepository,
    private readonly languageService: LanguageService,
    private readonly countryService: CountryService,
    private readonly stepLogRepo: StepLogRepository,
    private readonly tfaService: TfaService,
    private readonly kycNotificationService: KycNotificationService,
    @Inject(forwardRef(() => BankDataService)) private readonly bankDataService: BankDataService,
    private readonly walletService: WalletService,
    private readonly accountMergeService: AccountMergeService,
    private readonly webhookService: WebhookService,
    private readonly sumsubService: SumsubService,
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
      relations: { userData: { kycSteps: true } },
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
      where: {
        name: KycStepName.IDENT,
        status: KycStepStatus.INTERNAL_REVIEW,
        type: Not(KycStepType.MANUAL),
        userData: { kycSteps: { name: KycStepName.NATIONALITY_DATA, status: KycStepStatus.COMPLETED } },
      },
      relations: { userData: { kycSteps: true } },
    });

    for (const entity of entities) {
      try {
        const result = entity.resultData;

        const nationality = result.nationality
          ? await this.countryService.getCountryWithSymbol(result.nationality)
          : null;

        const errors = this.getIdentCheckErrors(entity, result, nationality);

        entity.comment = errors.join(';');

        if (errors.includes(IdentCheckError.USER_DATA_BLOCKED) || errors.includes(IdentCheckError.USER_DATA_MERGED)) {
          entity.ignored();
        } else if (
          errors.includes(IdentCheckError.VERIFIED_NAME_MISSING) &&
          errors.length === 1 &&
          entity.userData.accountType === AccountType.PERSONAL
        ) {
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
          entity.userData = await this.completeIdent(result, entity.userData, nationality);

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

    return KycStepMapper.toKycResult(kycStep);
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

    return KycStepMapper.toKycResult(kycStep);
  }

  async updateKycStep(
    kycHash: string,
    stepId: number,
    data: Partial<UserData>,
    requiresInternalReview: boolean,
  ): Promise<KycResultDto> {
    let user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    if (data.nationality) {
      const nationality = await this.countryService.getCountry(data.nationality.id);
      if (!nationality) throw new BadRequestException('Nationality not found');
    } else {
      user = await this.userDataService.updateUserDataInternal(user, data);
    }

    user = requiresInternalReview ? user.internalReviewStep(kycStep, data) : user.completeStep(kycStep, data);
    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return KycStepMapper.toKycResult(kycStep);
  }

  async updateFileData(kycHash: string, stepId: number, data: KycFileData, fileType: FileType): Promise<KycResultDto> {
    let user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    // upload file
    const { contentType, buffer } = Util.fromBase64(data.file);
    const url = await this.documentService.uploadUserFile(
      user.id,
      fileType,
      data.fileName,
      buffer,
      contentType as ContentType,
    );

    user = user.internalReviewStep(kycStep, url);
    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return KycStepMapper.toKycResult(kycStep);
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

    return KycStepMapper.toKycResult(kycStep);
  }

  async updateIntrumIdent(dto: IdentResultDto): Promise<void> {
    const { id: sessionId, transactionnumber: transactionId, reason } = dto.identificationprocess;
    if (!sessionId || !transactionId) throw new BadRequestException(`Session data is missing`);

    const result = getIdentResult(dto);
    if (!result)
      throw new Error(
        `Received unknown intrum ident result for transaction ${transactionId}: ${dto.identificationprocess.result}`,
      );

    this.logger.info(`Received intrum ident webhook call for transaction ${transactionId}: ${result}`);

    await this.updateIdent(transactionId, dto, result, reason);
  }

  async updateSumsubIdent(dto: WebhookResult): Promise<void> {
    const { externalUserId: transactionId } = dto;

    const result = getSumsubResult(dto);
    if (!result) throw new Error(`Received unknown sumsub ident result for transaction ${transactionId}: ${dto.type}`);

    this.logger.info(`Received sumsub ident webhook call for transaction ${transactionId}: ${result}`);

    const data = await this.sumsubService.getApplicantData(dto.applicantId);

    await this.updateIdent(transactionId, { webhook: dto, data }, result, IdentReason.IDENT_OTHER); // TODO: map reasons
  }

  private async updateIdent(
    transactionId: string,
    dto: IdentResultDto | SumsubResult,
    result: IdentShortResult,
    reason: IdentReason,
  ): Promise<void> {
    if (!transactionId.includes(Config.kyc.transactionPrefix)) {
      this.logger.verbose(`Received webhook call for a different system: ${transactionId}`);
      return;
    }

    const transaction = await this.getUserByTransactionOrThrow(transactionId, dto);

    let user = transaction.user;
    const kycStep = user.getStepOrThrow(transaction.stepId);

    switch (result) {
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
        throw new Error(`Unknown ident result for user ${user.id}: ${result}`);
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

  // --- STEPPING METHODS --- //
  async getOrCreateStepInternal(
    kycHash: string,
    name: KycStepName,
    type?: KycStepType,
    sequence?: number,
    restartCompletedSteps = false,
  ): Promise<{ user: UserData; step: KycStep }> {
    const user = await this.getUser(kycHash);

    let step =
      sequence != null
        ? user.getStepsWith(name, type, sequence)[0]
        : user
            .getStepsWith(name, type)
            .find((s) => s.isInProgress || s.isInReview || (!restartCompletedSteps && s.isCompleted));
    if (!step) {
      step = await this.initiateStep(user, name, type, true);
      user.nextStep(step);

      await this.userDataService.save(user);
    }

    return { user, step };
  }

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

    const { user, step } = await this.getOrCreateStepInternal(kycHash, name, type, sequence, true);

    await this.verify2faIfRequired(user, ip);

    return this.toDto(user, true, step);
  }

  private async updateProgress(user: UserData, shouldContinue: boolean, autoStep = true, depth = 0): Promise<UserData> {
    if (!user.hasStepsInProgress) {
      const { nextStep, nextLevel } = await this.getNext(user);

      if (nextLevel && nextLevel > user.kycLevel) {
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
    const missingSteps = requiredKycSteps(user).filter((rs) => !user.hasDoneStep(rs));

    const nextStep = missingSteps[0];

    const lastTry = nextStep && Util.maxObj(user.getStepsWith(nextStep), 'sequenceNumber');
    const preventDirectEvaluation = lastTry != null;

    switch (nextStep) {
      case KycStepName.CONTACT_DATA:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.PERSONAL_DATA:
        return { nextStep: { name: nextStep, preventDirectEvaluation }, nextLevel: KycLevel.LEVEL_10 };

      case KycStepName.LEGAL_ENTITY:
        return { nextStep: { name: nextStep, preventDirectEvaluation }, nextLevel: KycLevel.LEVEL_20 };

      case KycStepName.STOCK_REGISTER:
        return { nextStep: { name: nextStep, preventDirectEvaluation }, nextLevel: KycLevel.LEVEL_20 };

      case KycStepName.NATIONALITY_DATA:
        return { nextStep: { name: nextStep, preventDirectEvaluation }, nextLevel: KycLevel.LEVEL_20 };

      case KycStepName.COMMERCIAL_REGISTER:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.SIGNATORY_POWER:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.AUTHORITY:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.IDENT:
        return {
          nextStep: {
            name: nextStep,
            type:
              lastTry?.type === KycStepType.VIDEO ? KycStepType.VIDEO : await this.userDataService.getIdentMethod(user),
            preventDirectEvaluation,
          },
        };

      case KycStepName.FINANCIAL_DATA:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.DFX_APPROVAL:
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
        if (kycStep.isSumsub) {
          kycStep.transactionId = SumsubService.transactionId(user, kycStep);
          kycStep.sessionId = await this.sumsubService.initiateIdent(user, kycStep);
        } else {
          kycStep.transactionId = IdentService.transactionId(user, kycStep);
          kycStep.sessionId = await this.identService.initiateIdent(user, kycStep);
        }

        if (!user.getStepsWith(KycStepName.IDENT).length) await this.kycNotificationService.sendIdentStartedMail(user);
        break;

      case KycStepName.DFX_APPROVAL:
        kycStep.internalReview();
        break;
    }

    return kycStep;
  }

  // --- HELPER METHODS --- //

  async completeCommercialRegister(userData: UserData): Promise<UserData> {
    if (!userData.verifiedName && userData.organizationName)
      return this.userDataService.updateUserDataInternal(userData, { verifiedName: userData.organizationName });
  }

  async completeIdent(data: KycResultData, userData: UserData, nationality?: Country): Promise<UserData> {
    const identificationType = getIdentificationType(data.identificationType);
    if (
      data.birthday &&
      data.nationality &&
      identificationType &&
      data.identificationDocType &&
      data.identificationDocNumber &&
      nationality
    ) {
      const identDocumentId = `${userData.organizationName?.split(' ')?.join('') ?? ''}${data.identificationDocNumber}`;
      const existing = await this.userDataService.getDifferentUserWithSameIdentDoc(userData.id, identDocumentId);

      if (existing) {
        await this.accountMergeService.sendMergeRequest(existing, userData);

        return userData;
      } else if (nationality) {
        return this.userDataService.updateUserDataInternal(userData, {
          kycLevel: KycLevel.LEVEL_30,
          birthday: data.birthday,
          verifiedCountry: !userData.verifiedCountry ? userData.country : undefined,
          identificationType,
          bankTransactionVerification:
            identificationType === KycIdentificationType.VIDEO_ID ? CheckStatus.UNNECESSARY : undefined,
          identDocumentType: data.identificationDocType,
          identDocumentId,
          nationality,
        });
      }
    }

    this.logger.error(`Missing ident data for userData ${userData.id}`);

    return userData;
  }

  private getIdentCheckErrors(entity: KycStep, data: KycResultData, nationality?: Country): IdentCheckError[] {
    const errors = [];
    const nationalityStepResult = entity.userData
      .getStepsWith(KycStepName.NATIONALITY_DATA)
      .find((s) => s.isCompleted)
      .getResult<{ nationality: IEntity }>();

    if (entity.userData.status === UserDataStatus.MERGED) errors.push(IdentCheckError.USER_DATA_MERGED);
    if (entity.userData.isBlocked || entity.userData.isDeactivated) errors.push(IdentCheckError.USER_DATA_BLOCKED);

    if (!Util.isSameName(entity.userData.firstname, data.firstname))
      errors.push(IdentCheckError.FIRST_NAME_NOT_MATCHING);
    if (
      !Util.isSameName(entity.userData.surname, data.lastname) &&
      !Util.isSameName(entity.userData.surname, data.birthname)
    )
      errors.push(IdentCheckError.LAST_NAME_NOT_MATCHING);

    if (!nationality) {
      errors.push(IdentCheckError.NATIONALITY_MISSING);
    } else if (!nationalityStepResult || nationalityStepResult.nationality.id !== nationality?.id) {
      errors.push(IdentCheckError.NATIONALITY_NOT_MATCHING);
    }

    if (!['IDCARD', 'PASSPORT'].includes(data.identificationDocType))
      errors.push(IdentCheckError.INVALID_DOCUMENT_TYPE);

    if (!data.identificationDocNumber) errors.push(IdentCheckError.IDENTIFICATION_NUMBER_MISSING);

    if (!['SUCCESS_DATA_CHANGED', 'SUCCESS'].includes(data.result)) errors.push(IdentCheckError.INVALID_RESULT);

    if (entity.userData.accountType === AccountType.PERSONAL) {
      if (!entity.userData.verifiedName && entity.userData.status === UserDataStatus.ACTIVE) {
        errors.push(IdentCheckError.VERIFIED_NAME_MISSING);
      } else if (entity.userData.verifiedName) {
        if (!Util.includesSameName(entity.userData.verifiedName, entity.userData.firstname))
          errors.push(IdentCheckError.FIRST_NAME_NOT_MATCHING_VERIFIED_NAME);
        if (!Util.includesSameName(entity.userData.verifiedName, entity.userData.surname))
          errors.push(IdentCheckError.LAST_NAME_NOT_MATCHING_VERIFIED_NAME);
      }
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
    return this.userDataService.getByKycHashOrThrow(kycHash, { users: true, kycSteps: true });
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
    const documents = kycStep.isSumsub
      ? await this.sumsubService.getDocuments(kycStep)
      : await this.identService.getDocuments(kycStep);

    for (const { name, content, contentType } of documents) {
      await this.documentService.uploadFile(
        user.id,
        FileType.IDENTIFICATION,
        `${namePrefix}${name}`,
        content,
        contentType,
      );
    }
  }
}
