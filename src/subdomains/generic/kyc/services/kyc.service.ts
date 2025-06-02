import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { LanguageService } from 'src/shared/models/language/language.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { MailFactory, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { LessThan } from 'typeorm';
import { MergeReason } from '../../user/models/account-merge/account-merge.entity';
import { AccountMergeService } from '../../user/models/account-merge/account-merge.service';
import { BankDataType } from '../../user/models/bank-data/bank-data.entity';
import { BankDataService } from '../../user/models/bank-data/bank-data.service';
import { UserDataRelationState } from '../../user/models/user-data-relation/dto/user-data-relation.enum';
import { UserDataRelationService } from '../../user/models/user-data-relation/user-data-relation.service';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { KycIdentificationType } from '../../user/models/user-data/kyc-identification-type.enum';
import { KycLevel, KycType, UserData, UserDataStatus } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { WalletService } from '../../user/models/wallet/wallet.service';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { IdentResultData, IdentType } from '../dto/ident-result-data.dto';
import {
  IdNowReason,
  IdNowResult,
  IdentShortResult,
  getIdNowIdentReason,
  getIdentResult,
} from '../dto/ident-result.dto';
import { IdentDocument, IdentStatus } from '../dto/ident.dto';
import {
  ContactPersonData,
  KycBeneficialData,
  KycContactData,
  KycFileData,
  KycManualIdentData,
  KycNationalityData,
  KycOperationalData,
  KycPersonalData,
} from '../dto/input/kyc-data.dto';
import { KycFinancialInData, KycFinancialResponse } from '../dto/input/kyc-financial-in.dto';
import { KycError } from '../dto/kyc-error.enum';
import { FileType, KycFileDataDto } from '../dto/kyc-file.dto';
import { KycFileMapper } from '../dto/mapper/kyc-file.mapper';
import { KycInfoMapper } from '../dto/mapper/kyc-info.mapper';
import { KycStepMapper } from '../dto/mapper/kyc-step.mapper';
import { KycFinancialOutData } from '../dto/output/kyc-financial-out.dto';
import { KycLevelDto, KycSessionDto, KycStepBase } from '../dto/output/kyc-info.dto';
import {
  SumSubBlockLabels,
  SumSubRejectionLabels,
  SumSubWebhookResult,
  SumsubResult,
  getSumSubReason,
  getSumsubResult,
} from '../dto/sum-sub.dto';
import { KycStep, KycStepResult } from '../entities/kyc-step.entity';
import { ContentType } from '../enums/content-type.enum';
import { FileCategory } from '../enums/file-category.enum';
import { KycStepName } from '../enums/kyc-step-name.enum';
import { KycStepStatus, KycStepType, getIdentificationType, requiredKycSteps } from '../enums/kyc.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { StepLogRepository } from '../repositories/step-log.repository';
import { FinancialService } from './integration/financial.service';
import { IdentService } from './integration/ident.service';
import { KycDocumentService } from './integration/kyc-document.service';
import { SumsubService } from './integration/sum-sub.service';
import { KycFileService } from './kyc-file.service';
import { KycLogService } from './kyc-log.service';
import { KycNotificationService } from './kyc-notification.service';
import { TfaLevel, TfaService } from './tfa.service';

@Injectable()
export class KycService {
  private readonly logger = new DfxLogger(KycService);

  private readonly webhookQueue: QueueHandler;

  constructor(
    @Inject(forwardRef(() => UserDataService))
    private readonly userDataService: UserDataService,
    private readonly identService: IdentService,
    private readonly financialService: FinancialService,
    private readonly documentService: KycDocumentService,
    private readonly kycStepRepo: KycStepRepository,
    private readonly kycLogService: KycLogService,
    private readonly languageService: LanguageService,
    private readonly countryService: CountryService,
    private readonly stepLogRepo: StepLogRepository,
    private readonly tfaService: TfaService,
    private readonly kycFileService: KycFileService,
    private readonly kycNotificationService: KycNotificationService,
    @Inject(forwardRef(() => BankDataService))
    private readonly bankDataService: BankDataService,
    private readonly walletService: WalletService,
    private readonly accountMergeService: AccountMergeService,
    private readonly webhookService: WebhookService,
    private readonly sumsubService: SumsubService,
    private readonly mailFactory: MailFactory,
    @Inject(forwardRef(() => UserDataRelationService))
    private readonly userDataRelationService: UserDataRelationService,
  ) {
    this.webhookQueue = new QueueHandler();
  }

  @DfxCron(CronExpression.EVERY_DAY_AT_4AM, { process: Process.KYC })
  async checkIdentSteps(): Promise<void> {
    const expiredIdentSteps = await this.kycStepRepo.find({
      where: {
        name: KycStepName.IDENT,
        status: KycStepStatus.IN_PROGRESS,
        created: LessThan(Util.daysBefore(Config.kyc.identFailAfterDays - 1)),
      },
      relations: { userData: true },
    });

    for (const identStep of expiredIdentSteps) {
      identStep.userData.kycSteps = await this.kycStepRepo.findBy({ userData: { id: identStep.userData.id } });
      const user = identStep.userData;
      const step = user.getPendingStepOrThrow(identStep.id);

      await this.kycStepRepo.update(...step.fail());

      await this.createStepLog(user, step);

      await this.kycNotificationService.kycStepFailed(
        user,
        this.getMailStepName(identStep.name, identStep.userData.language.symbol),
        'Identification session has expired',
      );
    }
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.KYC })
  async reviewKycSteps(): Promise<void> {
    await this.reviewNationalityStep();
    await this.reviewIdentSteps();
  }

  async reviewNationalityStep(): Promise<void> {
    if (DisabledProcess(Process.KYC_NATIONALITY_REVIEW)) return;

    const entities = await this.kycStepRepo.find({
      where: {
        name: KycStepName.NATIONALITY_DATA,
        status: KycStepStatus.INTERNAL_REVIEW,
      },
      relations: { userData: true },
    });

    for (const entity of entities) {
      try {
        entity.userData.kycSteps = await this.kycStepRepo.findBy({ userData: { id: entity.userData.id } });
        const result = entity.getResult<KycNationalityData>();
        const nationality = await this.countryService.getCountry(result.nationality.id);
        const errors = this.getNationalityErrors(entity, nationality);
        const comment = errors.join(';');

        if (errors.includes(KycError.USER_DATA_BLOCKED) || errors.includes(KycError.USER_DATA_MERGED)) {
          await this.kycStepRepo.update(...entity.ignored(comment));
        } else if (errors.length > 0) {
          await this.kycStepRepo.update(...entity.manualReview(comment));
        } else {
          await this.kycStepRepo.update(...entity.complete());
          await this.checkDfxApproval(entity);
        }

        await this.createStepLog(entity.userData, entity);
      } catch (e) {
        this.logger.error(`Failed to auto review nationality step ${entity.id}:`, e);
      }
    }
  }

  async reviewIdentSteps(): Promise<void> {
    if (DisabledProcess(Process.KYC_IDENT_REVIEW)) return;

    const entities = await this.kycStepRepo.find({
      where: {
        name: KycStepName.IDENT,
        status: KycStepStatus.INTERNAL_REVIEW,
        userData: { kycSteps: { name: KycStepName.NATIONALITY_DATA, status: KycStepStatus.COMPLETED } },
      },
      relations: { userData: true },
    });

    for (const entity of entities) {
      try {
        entity.userData.kycSteps = await this.kycStepRepo.findBy({ userData: { id: entity.userData.id } });
        const result = entity.resultData;

        const nationality = result.nationality
          ? await this.countryService.getCountryWithSymbol(result.nationality)
          : null;
        const nationalityStep = entity.userData.getStepsWith(KycStepName.NATIONALITY_DATA).find((s) => s.isCompleted);

        const errors = this.getIdentCheckErrors(entity, nationalityStep, result, nationality);
        const comment = errors.join(';');

        if (errors.includes(KycError.REVERSED_NAMES)) {
          await this.userDataService.updateUserDataInternal(entity.userData, {
            firstname: entity.userData.surname,
            surname: entity.userData.firstname,
          });
          continue;
        } else if (errors.includes(KycError.NATIONALITY_NOT_MATCHING)) {
          await this.kycStepRepo.update(...nationalityStep.fail(undefined, KycError.NATIONALITY_NOT_MATCHING));
          if (errors.length === 1) {
            await this.kycNotificationService.kycStepFailed(
              entity.userData,
              this.getMailStepName(entity.name, entity.userData.language.symbol),
              this.getMailFailedReason(comment, entity.userData.language.symbol),
            );
            continue;
          }
        }

        if (errors.includes(KycError.USER_DATA_BLOCKED) || errors.includes(KycError.USER_DATA_MERGED)) {
          entity.ignored(comment);
        } else if (
          errors.includes(KycError.VERIFIED_NAME_MISSING) &&
          errors.length === 1 &&
          entity.userData.accountType === AccountType.PERSONAL
        ) {
          await this.userDataService.updateUserDataInternal(entity.userData, {
            verifiedName: `${entity.userData.firstname} ${entity.userData.surname}`,
          });
          entity.complete();
        } else if (errors.length === 0 && !entity.isManual) {
          entity.complete();
        } else {
          entity.manualReview(comment);
        }

        await this.createStepLog(entity.userData, entity);
        await this.kycStepRepo.save(entity);

        if (entity.isCompleted) {
          await this.completeIdent(entity, nationality);
          await this.checkDfxApproval(entity);
        }
      } catch (e) {
        this.logger.error(`Failed to auto review ident step ${entity.id}:`, e);
      }
    }
  }

  async checkDfxApproval(kycStep: KycStep): Promise<void> {
    const missingCompletedSteps = requiredKycSteps(kycStep.userData).filter(
      (rs) => !kycStep.userData.hasCompletedStep(rs),
    );

    if (
      (missingCompletedSteps.length === 2 && missingCompletedSteps.some((s) => s === kycStep.name)) ||
      (missingCompletedSteps.length === 1 &&
        missingCompletedSteps[0] === KycStepName.DFX_APPROVAL &&
        kycStep.name !== KycStepName.DFX_APPROVAL)
    ) {
      const approvalStep = kycStep.userData.kycSteps.find((s) => s.name === KycStepName.DFX_APPROVAL);
      await this.kycStepRepo.update(...approvalStep.manualReview());
    }
  }

  async syncIdentStep(kycStep: KycStep): Promise<void> {
    if (!kycStep.isInReview) throw new BadRequestException(`Invalid KYC step status ${kycStep.status}`);
    if (kycStep.isSumsub) throw new BadRequestException('Ident step sync is only available for IDnow');

    const result = await this.identService.getResult(kycStep);
    return this.updateIntrumIdent(result);
  }

  async getInfo(kycHash: string): Promise<KycLevelDto> {
    const user = await this.getUser(kycHash);
    await this.verifyUserDuplication(user);

    return this.toDto(user, false);
  }

  async getFileByUid(uid: string, userDataId?: number, role?: UserRole): Promise<KycFileDataDto> {
    const kycFile = await this.kycFileService.getKycFile(uid);

    if (!kycFile) throw new NotFoundException('KYC file not found');

    if (kycFile.protected && ![UserRole.ADMIN, UserRole.COMPLIANCE].includes(role)) {
      throw new ForbiddenException('Requires admin or compliance role');
    }

    const blob = await this.documentService.downloadFile(
      FileCategory.USER,
      kycFile.userData.id,
      kycFile.type,
      kycFile.name,
    );

    const log = `User ${userDataId} is downloading KYC file ${kycFile.name} (ID: ${kycFile.id})`;
    await this.kycLogService.createKycFileLog(log, kycFile.userData);

    return KycFileMapper.mapKycFile(kycFile, blob);
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

  public getMailFailedReason(comment: string, language: string): string {
    return `<ul>${comment
      ?.split(';')
      .map(
        (c) =>
          `<li>${this.mailFactory.translate(
            MailFactory.parseMailKey(MailTranslationKey.KYC_FAILED_REASONS, c),
            language,
          )}</li>`,
      )
      .join('')}</ul>`;
  }

  public getMailStepName(kycStepName: KycStepName, language: string): string {
    return this.mailFactory.translate(
      MailFactory.parseMailKey(MailTranslationKey.KYC_STEP_NAMES, kycStepName),
      language,
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
    if (user.hasCompletedStep(KycStepName.CONTACT_DATA) && user.kycLevel < KycLevel.LEVEL_50)
      await this.userDataService.checkMail(user, user.mail);
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
  async updateContactData(kycHash: string, stepId: number, data: KycContactData): Promise<KycStepBase> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    const result = await this.trySetMail(user, kycStep, data.mail);
    await this.kycStepRepo.update(...result);

    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return KycStepMapper.toStepBase(kycStep);
  }

  async updatePersonalData(kycHash: string, stepId: number, data: KycPersonalData): Promise<KycStepBase> {
    let user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    user = await this.userDataService.updatePersonalData(user, data);

    if (user.isDataComplete) {
      await this.kycStepRepo.update(...kycStep.complete(data));
      await this.createStepLog(user, kycStep);
    }

    await this.updateProgress(user, false);

    return KycStepMapper.toStepBase(kycStep);
  }

  async updateKycStep(
    kycHash: string,
    stepId: number,
    data: Partial<UserData>,
    reviewStatus: KycStepStatus,
  ): Promise<KycStepBase> {
    let user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    if (data.nationality) {
      const nationality = await this.countryService.getCountry(data.nationality.id);
      if (!nationality) throw new BadRequestException('Nationality not found');
    } else {
      user = await this.userDataService.updateUserDataInternal(user, data);
    }

    return this.updateKycStepAndLog(kycStep, user, data, reviewStatus);
  }

  async updateBeneficialOwnerData(kycHash: string, stepId: number, data: KycBeneficialData): Promise<KycStepBase> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    const allBeneficialOwnersName = [];
    const allBeneficialOwnersDomicile = [];

    if (data.managingDirector) {
      const managingDirector = await this.createRelatedUserData(
        data.managingDirector,
        user,
        UserDataRelationState.CONTROL_HOLDER,
      );

      allBeneficialOwnersName.push(managingDirector.verifiedName);
      allBeneficialOwnersDomicile.push(managingDirector.country.name);
    }

    for (const owner of data.beneficialOwners) {
      const beneficialOwner = await this.createRelatedUserData(owner, user, UserDataRelationState.BENEFICIAL_OWNER);

      allBeneficialOwnersName.push(beneficialOwner.verifiedName);
      allBeneficialOwnersDomicile.push(beneficialOwner.country.name);
    }

    await this.userDataService.updateUserDataInternal(user, {
      allBeneficialOwnersName: allBeneficialOwnersName.join('\n'),
      allBeneficialOwnersDomicile: allBeneficialOwnersDomicile.join('\n'),
    });

    return this.updateKycStepAndLog(kycStep, user, data, KycStepStatus.MANUAL_REVIEW);
  }

  async updateOperationActivityData(kycHash: string, stepId: number, data: KycOperationalData): Promise<KycStepBase> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    return this.updateKycStepAndLog(kycStep, user, data, KycStepStatus.MANUAL_REVIEW);
  }

  async updateFileData(kycHash: string, stepId: number, data: KycFileData, fileType: FileType): Promise<KycStepBase> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    // upload file
    const { contentType, buffer } = Util.fromBase64(data.file);
    const { url } = await this.documentService.uploadUserFile(
      user,
      fileType,
      data.fileName,
      buffer,
      contentType as ContentType,
      false,
      kycStep,
    );

    await this.kycStepRepo.update(...kycStep.manualReview(undefined, url));
    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return KycStepMapper.toStepBase(kycStep);
  }

  async getFinancialData(kycHash: string, ip: string, stepId: number, lang?: string): Promise<KycFinancialOutData> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    await this.verify2fa(user, ip);

    const language = (lang && (await this.languageService.getLanguageBySymbol(lang.toUpperCase()))) ?? user.language;

    const questions = this.financialService.getQuestions(language.symbol.toLowerCase(), user.accountType);
    const responses = kycStep.getResult<KycFinancialResponse[]>() ?? [];
    return { questions, responses };
  }

  async updateFinancialData(
    kycHash: string,
    ip: string,
    stepId: number,
    data: KycFinancialInData,
  ): Promise<KycStepBase> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    await this.verify2fa(user, ip);

    await this.kycStepRepo.update(...kycStep.update(undefined, data.responses));

    const complete = this.financialService.isComplete(data.responses, user.accountType);
    if (complete) {
      await this.kycStepRepo.update(...kycStep.internalReview());
      await this.createStepLog(user, kycStep);
    }

    await this.updateProgress(user, false);

    return KycStepMapper.toStepBase(kycStep);
  }

  async updateIntrumIdent(dto: IdNowResult): Promise<void> {
    const { id: sessionId, transactionnumber: transactionId, reason } = dto.identificationprocess;
    if (!sessionId || !transactionId) throw new BadRequestException(`Session data is missing`);

    const result = getIdentResult(dto);
    if (!result)
      throw new Error(
        `Received unknown intrum ident result for transaction ${transactionId}: ${dto.identificationprocess.result}`,
      );

    this.logger.info(`Received intrum ident webhook call for transaction ${transactionId}: ${result}`);

    await this.updateIdent(IdentType.ID_NOW, transactionId, dto, result, [reason]);
  }

  async updateSumsubIdent(dto: SumSubWebhookResult): Promise<void> {
    const { externalUserId: transactionId } = dto;

    const result = getSumsubResult(dto);
    if (!result) {
      this.logger.info(`Ignoring Sumsub webhook call for ${transactionId} due to unknown result: ${dto.type}`);
      return;
    }

    this.logger.info(`Received sumsub ident webhook call for transaction ${transactionId}: ${result}`);

    const data = await this.sumsubService.getApplicantData(dto.applicantId);

    return this.webhookQueue.handle(() =>
      this.updateIdent(
        IdentType.SUM_SUB,
        transactionId,
        { webhook: dto, data },
        result,
        dto.reviewResult?.rejectLabels,
      ),
    );
  }

  private async updateKycStepAndLog(
    kycStep: KycStep,
    user: UserData,
    data: KycStepResult,
    reviewStatus: KycStepStatus,
  ): Promise<KycStepBase> {
    await this.kycStepRepo.update(...kycStep.update(reviewStatus, data));
    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return KycStepMapper.toStepBase(kycStep);
  }

  private async createRelatedUserData(
    owner: ContactPersonData,
    user: UserData,
    relation: UserDataRelationState,
  ): Promise<UserData> {
    const beneficialOwner = await this.userDataService.createUserData({
      kycType: KycType.DFX,
      status: UserDataStatus.KYC_ONLY,
      firstname: owner.firstName,
      surname: owner.lastName,
      street: owner.street,
      houseNumber: owner.houseNumber,
      location: owner.city,
      zip: owner.zip,
      country: owner.country,
      verifiedName: `${owner.firstName} ${owner.lastName}`,
      verifiedCountry: owner.country,
      organization: user.organization,
    });

    await this.userDataRelationService.createUserDataRelationInternal(beneficialOwner, user, { relation });

    await this.bankDataService.createVerifyBankData(beneficialOwner, {
      type: BankDataType.NAME_CHECK,
      iban: `NameCheck-${owner.firstName}${owner.lastName}`,
      name: beneficialOwner.verifiedName,
    });

    return beneficialOwner;
  }

  private async updateIdent(
    type: IdentType,
    transactionId: string,
    dto: IdNowResult | SumsubResult,
    result: IdentShortResult,
    reason: (IdNowReason | SumSubRejectionLabels)[],
  ): Promise<void> {
    if (!transactionId.includes(Config.kyc.transactionPrefix)) {
      this.logger.verbose(`Received webhook call for a different system: ${transactionId}`);
      return;
    }

    const transaction = await this.getUserByTransactionOrThrow(transactionId, dto);

    const user = transaction.user;
    const kycStep = user.getStepOrThrow(transaction.stepId);

    if (result === IdentShortResult.MEDIA) {
      await this.downloadMedia(user, kycStep);
      this.logger.info(`Media download finished for KYC step: ${kycStep.id}`);
      return;
    }

    if (!kycStep.isInProgress && !kycStep.isInReview) {
      this.logger.verbose(`Received KYC webhook call dropped: ${kycStep.id}`);
      return;
    }

    switch (result) {
      case IdentShortResult.CANCEL:
        await this.kycStepRepo.update(...kycStep.pause(dto));
        await this.kycNotificationService.kycStepFailed(
          user,
          this.getMailStepName(kycStep.name, kycStep.userData.language.symbol),
          this.getIdentReason(type, reason),
        );
        break;

      case IdentShortResult.ABORT:
        await this.kycStepRepo.update(...kycStep.pause(dto));
        break;

      case IdentShortResult.PENDING:
        if ([KycStepStatus.EXTERNAL_REVIEW].includes(kycStep.status))
          await this.kycStepRepo.update(...kycStep.inProgress(dto));
        break;

      case IdentShortResult.REVIEW:
        if (!kycStep.isDone) await this.kycStepRepo.update(...kycStep.externalReview());
        break;

      case IdentShortResult.SUCCESS:
        await this.kycStepRepo.update(...kycStep.internalReview(dto));
        await this.downloadIdentDocuments(user, kycStep);
        break;

      case IdentShortResult.FAIL:
      case IdentShortResult.RETRY:
        // retrigger personal data step, if data was wrong
        if (reason.includes(SumSubRejectionLabels.PROBLEMATIC_APPLICANT_DATA))
          await this.initiateStep(user, KycStepName.PERSONAL_DATA, undefined, true);

        await this.kycStepRepo.update(
          ...(result === IdentShortResult.FAIL ? kycStep.fail(dto) : kycStep.inProgress(dto)),
        );
        await this.downloadIdentDocuments(user, kycStep, 'fail/');
        await this.kycNotificationService.kycStepFailed(
          user,
          this.getMailStepName(kycStep.name, kycStep.userData.language.symbol),
          this.getIdentReason(type, reason),
        );

        break;

      default:
        throw new Error(`Unknown ident result for user ${user.id}: ${result}`);
    }

    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);
  }

  async updateIdentManual(kycHash: string, stepId: number, dto: KycManualIdentData): Promise<KycStepBase> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    dto.nationality = await this.countryService.getCountry(dto.nationality.id);
    if (!dto.nationality) throw new NotFoundException('Country not found');

    const { contentType, buffer } = Util.fromBase64(dto.document.file);
    const { url } = await this.documentService.uploadUserFile(
      user,
      FileType.IDENTIFICATION,
      `${Util.isoDateTime(new Date()).split('-').join('')}_manual-ident_${Util.randomId()}_${dto.document.fileName}`,
      buffer,
      contentType as ContentType,
      false,
      kycStep,
    );

    await this.kycStepRepo.update(
      ...kycStep.internalReview({
        ...dto,
        documentUrl: url,
        document: undefined,
        birthday: Util.isoDate(dto.birthday),
      }),
    );

    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return KycStepMapper.toStepBase(kycStep);
  }

  private getIdentReason(type: IdentType, reason: (IdNowReason | SumSubRejectionLabels)[]): string {
    return type === IdentType.ID_NOW
      ? getIdNowIdentReason(reason[0])
      : getSumSubReason(reason as SumSubRejectionLabels[]);
  }

  async updateIdentStatus(transactionId: string, status: IdentStatus): Promise<string> {
    const transaction = await this.getUserByTransactionOrThrow(transactionId, status);

    const user = transaction.user;
    const kycStep = user.getStepOrThrow(transaction.stepId);

    if (status === IdentStatus.SUCCESS && !kycStep.result) {
      await this.kycStepRepo.update(...kycStep.finish());

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
      user.kycSteps.push(step);
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
        await this.userDataService.updateUserDataInternal(user, { kycLevel: nextLevel });
        await this.kycNotificationService.kycChanged(user, nextLevel);
      }

      if (nextStep && shouldContinue && (autoStep || depth === 0)) {
        // continue with next step
        const step = await this.initiateStep(user, nextStep.name, nextStep.type, nextStep.preventDirectEvaluation);
        user.kycSteps.push(step);

        // update again if step is complete
        if (step.isCompleted) return this.updateProgress(user, shouldContinue, autoStep, depth + 1);
      }
    }

    return user;
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

      case KycStepName.NATIONALITY_DATA:
      case KycStepName.LEGAL_ENTITY:
      case KycStepName.OWNER_DIRECTORY:
        return { nextStep: { name: nextStep, preventDirectEvaluation }, nextLevel: KycLevel.LEVEL_20 };

      case KycStepName.COMMERCIAL_REGISTER:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.SIGNATORY_POWER:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.BENEFICIAL_OWNER:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.OPERATIONAL_ACTIVITY:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.AUTHORITY:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.IDENT:
        const identSteps = user.getStepsWith(KycStepName.IDENT);
        if (
          identSteps.some((i) => i.comment?.split(';').includes(KycError.USER_DATA_EXISTING)) ||
          ((identSteps.some((i) => i.comment?.split(';').includes(KycError.BLOCKED)) ||
            identSteps.length > Config.kyc.maxIdentTries ||
            identSteps.some((i) =>
              i
                .getResult<SumsubResult>()
                ?.webhook?.reviewResult?.rejectLabels?.some((l) => SumSubBlockLabels.includes(l)),
            )) &&
            !identSteps.some((i) => i.comment?.split(';').includes(KycError.RELEASED)))
        )
          return { nextStep: undefined };

        const userDataMergeRequestedStep = identSteps.find(
          (i) => i.comment?.split(';').includes(KycError.USER_DATA_MERGE_REQUESTED) && i.sequenceNumber >= 0,
        );
        if (userDataMergeRequestedStep) {
          const existing = await this.userDataService.getDifferentUserWithSameIdentDoc(
            user.id,
            userDataMergeRequestedStep.identDocumentId,
          );

          if (existing)
            await this.accountMergeService.sendMergeRequest(existing, user, MergeReason.IDENT_DOCUMENT, true);

          return { nextStep: undefined };
        }

        return {
          nextStep: {
            name: nextStep,
            type:
              lastTry?.type === KycStepType.VIDEO || lastTry?.type === KycStepType.SUMSUB_VIDEO
                ? KycStepType.SUMSUB_VIDEO
                : await this.userDataService.getIdentMethod(user),
            preventDirectEvaluation,
          },
        };

      case KycStepName.FINANCIAL_DATA:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.ADDITIONAL_DOCUMENTS:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.RESIDENCE_PERMIT:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.DFX_APPROVAL:
        return lastTry && !lastTry.isFailed ? undefined : { nextStep: { name: nextStep, preventDirectEvaluation } };

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
    if (pendingStep) await this.kycStepRepo.update(...pendingStep.cancel());

    switch (stepName) {
      case KycStepName.CONTACT_DATA:
        if (user.mail && !preventDirectEvaluation) await this.trySetMail(user, kycStep, user.mail);
        break;

      case KycStepName.PERSONAL_DATA: {
        const completedStep = user.getStepsWith(KycStepName.PERSONAL_DATA).find((s) => s.isCompleted);
        if (completedStep) await this.kycStepRepo.update(...completedStep.cancel());

        const result = user.requiredKycFields.reduce((prev, curr) => ({ ...prev, [curr]: user[curr] }), {});
        if (user.isDataComplete && !preventDirectEvaluation) kycStep.complete(result);
        break;
      }

      case KycStepName.IDENT:
        if (kycStep.isSumsub) {
          kycStep.transactionId = SumsubService.transactionId(user, kycStep);
          kycStep.sessionId = await this.sumsubService.initiateIdent(user, kycStep);
        } else if (!kycStep.isManual) {
          throw new InternalServerErrorException('Intrum Ident not possible');
        }

        break;

      case KycStepName.DFX_APPROVAL:
        const missingCompletedSteps = requiredKycSteps(user).filter((rs) => !user.hasCompletedStep(rs));

        user.kycLevel >= KycLevel.LEVEL_50
          ? kycStep.complete()
          : missingCompletedSteps.length === 1
          ? kycStep.manualReview()
          : kycStep.onHold();

        break;
    }

    return this.kycStepRepo.save(kycStep);
  }

  // --- HELPER METHODS --- //
  async trySetMail(user: UserData, step: KycStep, mail: string): Promise<UpdateResult<KycStep>> {
    try {
      user = await this.userDataService.trySetUserMail(user, mail);
      return step.complete({ mail });
    } catch (e) {
      const error = (e as Error).message?.includes('account merge request sent')
        ? KycError.USER_DATA_MERGE_REQUESTED
        : KycError.USER_DATA_EXISTING;
      return step.fail({ mail }, error);
    }
  }

  async completeCommercialRegister(userData: UserData): Promise<UserData> {
    if (
      (!userData.verifiedName && userData.organizationName) ||
      (userData.kycLevel > KycLevel.LEVEL_30 && userData.highRisk == null && userData.hasValidNameCheckDate)
    )
      return this.userDataService.updateUserDataInternal(userData, {
        verifiedName: !userData.verifiedName && userData.organizationName ? userData.organizationName : undefined,
        pep:
          userData.kycLevel > KycLevel.LEVEL_30 && userData.highRisk == null && userData.hasValidNameCheckDate
            ? false
            : undefined,
      });
  }

  async completeIdent(kycStep: KycStep, nationality?: Country): Promise<void> {
    const data = kycStep.resultData;
    const userData = kycStep.userData;
    const identificationType = getIdentificationType(data.type, data.kycType);
    nationality ??= data.nationality ? await this.countryService.getCountryWithSymbol(data.nationality) : null;

    if (
      data.birthday &&
      data.nationality &&
      identificationType &&
      data.documentType &&
      data.documentNumber &&
      nationality
    ) {
      const existing = await this.userDataService.getDifferentUserWithSameIdentDoc(
        userData.id,
        kycStep.identDocumentId,
      );

      if (existing) {
        const mergeRequest = await this.accountMergeService.sendMergeRequest(
          existing,
          userData,
          MergeReason.IDENT_DOCUMENT,
          true,
        );

        await this.kycStepRepo.update(
          ...kycStep.fail(
            undefined,
            [kycStep.comment, mergeRequest ? KycError.USER_DATA_MERGE_REQUESTED : KycError.USER_DATA_EXISTING]
              .filter((c) => c)
              .join(';'),
          ),
        );

        return;
      } else if (nationality) {
        await this.userDataService.updateUserDataInternal(userData, {
          kycLevel: KycLevel.LEVEL_30,
          birthday: data.birthday,
          verifiedCountry: !userData.verifiedCountry ? userData.country : undefined,
          identificationType,
          bankTransactionVerification:
            identificationType === KycIdentificationType.VIDEO_ID ? CheckStatus.UNNECESSARY : undefined,
          identDocumentType: data.documentType,
          identDocumentId: kycStep.identDocumentId,
          olkypayAllowed: userData.olkypayAllowed ?? true,
          nationality,
        });

        if (kycStep.isValidCreatingBankData && !DisabledProcess(Process.AUTO_CREATE_BANK_DATA))
          await this.bankDataService.createVerifyBankData(kycStep.userData, {
            name: kycStep.userName,
            iban: `Ident${kycStep.identDocumentId}`,
            type: BankDataType.IDENT,
          });

        return;
      }
    }

    this.logger.error(`Missing ident data for userData ${userData.id}`);
  }

  private getStepDefaultErrors(entity: KycStep): KycError[] {
    const errors = [];
    if (entity.userData.status === UserDataStatus.MERGED) errors.push(KycError.USER_DATA_MERGED);
    if (entity.userData.isBlocked || entity.userData.isDeactivated) errors.push(KycError.USER_DATA_BLOCKED);

    return errors;
  }

  private getNationalityErrors(entity: KycStep, nationality: Country): KycError[] {
    const errors = this.getStepDefaultErrors(entity);
    if (!nationality.nationalityEnable) errors.push(KycError.NATIONALITY_NOT_ALLOWED);

    return errors;
  }

  private getIdentCheckErrors(
    identStep: KycStep,
    nationalityStep: KycStep,
    data: IdentResultData,
    nationality?: Country,
  ): KycError[] {
    const errors = this.getStepDefaultErrors(identStep);
    const nationalityStepResult = nationalityStep.getResult<{ nationality: IEntity }>();

    if (!Util.isSameName(identStep.userData.firstname, data.firstname)) errors.push(KycError.FIRST_NAME_NOT_MATCHING);
    if (
      !Util.isSameName(identStep.userData.surname, data.lastname) &&
      !Util.isSameName(identStep.userData.surname, data.birthname) &&
      (data.lastname || !Util.isSameName(identStep.userData.surname, data.firstname))
    )
      errors.push(KycError.LAST_NAME_NOT_MATCHING);

    if (
      (Util.isSameName(identStep.userData.firstname, data.lastname) ||
        Util.isSameName(identStep.userData.firstname, data.birthname)) &&
      Util.isSameName(identStep.userData.surname, data.firstname) &&
      errors.some((e) => [KycError.FIRST_NAME_NOT_MATCHING, KycError.LAST_NAME_NOT_MATCHING].includes(e))
    )
      errors.push(KycError.REVERSED_NAMES);

    if (!nationality) {
      errors.push(KycError.NATIONALITY_MISSING);
    } else if (!nationalityStepResult || nationalityStepResult.nationality.id !== nationality?.id) {
      errors.push(KycError.NATIONALITY_NOT_MATCHING);
    }

    if (!['IDCARD', 'PASSPORT'].includes(data.documentType)) errors.push(KycError.INVALID_DOCUMENT_TYPE);

    if (!data.documentNumber) errors.push(KycError.IDENTIFICATION_NUMBER_MISSING);

    if (!data.success) errors.push(KycError.INVALID_RESULT);

    const userCountry =
      identStep.userData.organizationCountry ?? identStep.userData.verifiedCountry ?? identStep.userData.country;
    if (identStep.userData.accountType === AccountType.PERSONAL) {
      if (userCountry && !userCountry.dfxEnable) errors.push(KycError.COUNTRY_NOT_ALLOWED);

      if (!identStep.userData.verifiedName && identStep.userData.status === UserDataStatus.ACTIVE) {
        errors.push(KycError.VERIFIED_NAME_MISSING);
      } else if (identStep.userData.verifiedName) {
        if (!Util.includesSameName(identStep.userData.verifiedName, identStep.userData.firstname))
          errors.push(KycError.FIRST_NAME_NOT_MATCHING_VERIFIED_NAME);
        if (!Util.includesSameName(identStep.userData.verifiedName, identStep.userData.surname))
          errors.push(KycError.LAST_NAME_NOT_MATCHING_VERIFIED_NAME);
      }
    } else {
      if (userCountry && !userCountry.dfxOrganizationEnable) errors.push(KycError.COUNTRY_NOT_ALLOWED);
    }

    return errors;
  }

  private async createStepLog(user: UserData, kycStep: KycStep): Promise<void> {
    const entity = this.stepLogRepo.create({
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
    return this.userDataService.getByKycHashOrThrow(kycHash, { users: true, kycSteps: { userData: true } });
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

  private async verify2faIfRequired(user: UserData, ip: string): Promise<void> {
    const has2faSteps = user.kycSteps.some(
      (s) =>
        ([KycStepName.FINANCIAL_DATA, KycStepName.BENEFICIAL_OWNER].includes(s.name) ||
          (s.name === KycStepName.IDENT && s.type !== KycStepType.MANUAL)) &&
        s.isInProgress,
    );
    if (has2faSteps) await this.verify2fa(user, ip);
  }

  private async verify2fa(user: UserData, ip: string): Promise<void> {
    await this.tfaService.checkVerification(user, ip, TfaLevel.STRICT);
  }

  private async downloadIdentDocuments(user: UserData, kycStep: KycStep, namePrefix?: string) {
    const documents = await this.sumsubService.getDocuments(kycStep);
    await this.storeDocuments(documents, user, kycStep, namePrefix);
  }

  private async downloadMedia(user: UserData, kycStep: KycStep, namePrefix?: string) {
    const documents = await this.sumsubService.getMedia(kycStep);
    await this.storeDocuments(documents, user, kycStep, namePrefix);
  }

  async syncIdentFiles(stepId: number): Promise<void> {
    const kycStep = await this.kycStepRepo.findOne({ where: { id: stepId }, relations: { userData: true } });
    if (!kycStep || kycStep.name !== KycStepName.IDENT) throw new NotFoundException('Invalid step');

    const userFiles = await this.documentService.listUserFiles(kycStep.userData.id);

    const documents = kycStep.isSumsub
      ? await this.sumsubService.getDocuments(kycStep)
      : await this.identService.getDocuments(kycStep);

    if (kycStep.isSumsubVideo) {
      documents.push(...(await this.sumsubService.getMedia(kycStep)));
    }

    const missingDocuments = documents.filter(
      (d) =>
        !userFiles.some(
          (f) =>
            f.type === FileType.IDENTIFICATION &&
            f.name.includes(kycStep.transactionId) &&
            f.contentType === d.contentType,
        ),
    );
    await this.storeDocuments(missingDocuments, kycStep.userData, kycStep);
  }

  private async storeDocuments(
    documents: IdentDocument[],
    user: UserData,
    kycStep: KycStep,
    namePrefix = '',
  ): Promise<void> {
    for (const { name, content, contentType, fileSubType } of documents) {
      await this.documentService.uploadFile(
        user,
        FileType.IDENTIFICATION,
        `${namePrefix}${name}`,
        content,
        contentType,
        true,
        kycStep,
        fileSubType,
      );
    }
  }
}
