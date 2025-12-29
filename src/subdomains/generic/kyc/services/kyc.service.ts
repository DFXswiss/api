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
import { PaymentLinkRecipientDto } from 'src/subdomains/core/payment-link/dto/payment-link-recipient.dto';
import { MailFactory, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { FindOptionsWhere, IsNull, LessThan, MoreThan, Not } from 'typeorm';
import { MergeReason } from '../../user/models/account-merge/account-merge.entity';
import { AccountMergeService } from '../../user/models/account-merge/account-merge.service';
import { BankDataType } from '../../user/models/bank-data/bank-data.entity';
import { BankDataService } from '../../user/models/bank-data/bank-data.service';
import { RecommendationService } from '../../user/models/recommendation/recommendation.service';
import { UserDataRelationState } from '../../user/models/user-data-relation/dto/user-data-relation.enum';
import { UserDataRelationService } from '../../user/models/user-data-relation/user-data-relation.service';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { KycIdentificationType } from '../../user/models/user-data/kyc-identification-type.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycLevel, KycType, UserDataStatus } from '../../user/models/user-data/user-data.enum';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { WalletService } from '../../user/models/wallet/wallet.service';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { IdentResultData, IdentType, NationalityDocType, ValidDocType } from '../dto/ident-result-data.dto';
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
  KycLegalEntityData,
  KycManualIdentData,
  KycNationalityData,
  KycOperationalData,
  KycPersonalData,
  KycRecommendationData,
  PaymentDataDto,
} from '../dto/input/kyc-data.dto';
import { KycFinancialInData, KycFinancialResponse } from '../dto/input/kyc-financial-in.dto';
import { KycError, KycStepIgnoringErrors } from '../dto/kyc-error.enum';
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
import { KycLogType, KycStepType, getIdentificationType, requiredKycSteps } from '../enums/kyc.enum';
import { ReviewStatus } from '../enums/review-status.enum';
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
    private readonly recommendationService: RecommendationService,
  ) {
    this.webhookQueue = new QueueHandler();
  }

  @DfxCron(CronExpression.EVERY_DAY_AT_4AM, { process: Process.KYC })
  async checkIdentSteps(): Promise<void> {
    const expiredIdentSteps = await this.kycStepRepo.find({
      where: {
        name: KycStepName.IDENT,
        status: ReviewStatus.IN_PROGRESS,
        created: LessThan(Util.daysBefore(Config.kyc.identFailAfterDays - 1)),
      },
      relations: { userData: { wallet: true } },
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
    await this.reviewFinancialData();
    await this.reviewRecommendationStep();
  }

  async reviewNationalityStep(): Promise<void> {
    if (DisabledProcess(Process.KYC_NATIONALITY_REVIEW)) return;

    const entities = await this.kycStepRepo.find({
      where: {
        name: KycStepName.NATIONALITY_DATA,
        status: ReviewStatus.INTERNAL_REVIEW,
      },
      relations: { userData: { wallet: true } },
    });

    for (const entity of entities) {
      try {
        entity.userData.kycSteps = await this.kycStepRepo.findBy({ userData: { id: entity.userData.id } });
        const result = entity.getResult<KycNationalityData>();
        const nationality = await this.countryService.getCountry(result.nationality.id);

        //Skip nationalities which needs a residencePermit first
        if (Config.kyc.residencePermitCountries.includes(nationality.symbol)) continue;

        const errors = this.getNationalityErrors(entity, nationality);
        const comment = errors.join(';');

        if (errors.some((e) => KycStepIgnoringErrors.includes(e))) {
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
        status: ReviewStatus.INTERNAL_REVIEW,
        userData: { kycSteps: { name: KycStepName.NATIONALITY_DATA, status: ReviewStatus.COMPLETED } },
      },
      relations: { userData: { users: true, wallet: true } },
    });

    for (const entity of entities) {
      try {
        entity.userData.kycSteps = await this.kycStepRepo.findBy({ userData: { id: entity.userData.id } });
        const result = entity.resultData;

        const nationality = result.nationality
          ? await this.countryService.getCountryWithSymbol(result.nationality)
          : null;
        const ipCountry = result.ipCountry ? await this.countryService.getCountryWithSymbol(result.ipCountry) : null;
        const country = result.country ? await this.countryService.getCountryWithSymbol(result.country) : null;

        const nationalityStep = entity.userData.getStepsWith(KycStepName.NATIONALITY_DATA).find((s) => s.isCompleted);

        const errors = this.getIdentCheckErrors(entity, nationalityStep, result, nationality, ipCountry, country);
        const comment = errors.join(';');

        if (errors.includes(KycError.REVERSED_NAMES)) {
          await this.userDataService.updateUserDataInternal(entity.userData, {
            firstname: entity.userData.surname,
            surname: entity.userData.firstname,
          });
          continue;
        } else if (errors.includes(KycError.NATIONALITY_NOT_MATCHING)) {
          await this.kycStepRepo.update(...nationalityStep.fail(undefined, KycError.NATIONALITY_NOT_MATCHING));
          await this.kycNotificationService.kycStepFailed(
            entity.userData,
            this.getMailStepName(KycStepName.NATIONALITY_DATA, entity.userData.language.symbol),
            this.getMailFailedReason(KycError.NATIONALITY_NOT_MATCHING, entity.userData.language.symbol),
          );

          if (
            errors.every((e) =>
              [
                KycError.NATIONALITY_NOT_MATCHING,
                KycError.IP_COUNTRY_MISMATCH,
                KycError.COUNTRY_IP_COUNTRY_MISMATCH,
              ].includes(e),
            )
          )
            continue;
        }

        if (errors.some((e) => KycStepIgnoringErrors.includes(e))) {
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

  async reviewFinancialData(): Promise<void> {
    if (DisabledProcess(Process.KYC_FINANCIAL_REVIEW)) return;

    const entities = await this.kycStepRepo.find({
      where: {
        name: KycStepName.FINANCIAL_DATA,
        status: ReviewStatus.INTERNAL_REVIEW,
        userData: { kycLevel: MoreThan(KycLevel.LEVEL_20) },
      },
      relations: { userData: { wallet: true } },
    });

    for (const entity of entities) {
      try {
        entity.userData.kycSteps = await this.kycStepRepo.findBy({ userData: { id: entity.userData.id } });

        const errors = this.getFinancialDataErrors(entity);
        const comment = errors.join(';');

        if (errors.some((e) => KycStepIgnoringErrors.includes(e))) {
          await this.kycStepRepo.update(...entity.ignored(comment));
        } else if (errors.includes(KycError.MISSING_RESPONSE)) {
          await this.kycStepRepo.update(...entity.inProgress());
          await this.kycNotificationService.kycStepMissingData(
            entity.userData,
            this.getMailStepName(entity.name, entity.userData.language.symbol),
          );
        } else if (errors.length === 0 && !entity.isManual) {
          await this.kycStepRepo.update(...entity.complete());
        } else {
          await this.kycStepRepo.update(...entity.manualReview(comment));
        }

        await this.createStepLog(entity.userData, entity);

        if (entity.isCompleted) {
          await this.completeFinancialData(entity);
          await this.checkDfxApproval(entity);
        }
      } catch (e) {
        this.logger.error(`Failed to auto review financialData step ${entity.id}:`, e);
      }
    }
  }

  async reviewRecommendationStep(): Promise<void> {
    if (DisabledProcess(Process.KYC_RECOMMENDATION_REVIEW)) return;

    const request: FindOptionsWhere<KycStep> = {
      name: KycStepName.RECOMMENDATION,
      status: ReviewStatus.INTERNAL_REVIEW,
    };

    const entities = await this.kycStepRepo.find({
      where: [
        {
          ...request,
          recommendation: { isConfirmed: Not(IsNull()) },
        },
        { ...request, recommendation: { expirationDate: LessThan(new Date()) } },
      ],
      relations: { userData: { wallet: true }, recommendation: { recommender: true } },
    });

    for (const entity of entities) {
      try {
        entity.userData.kycSteps = await this.kycStepRepo.findBy({ userData: { id: entity.userData.id } });

        const errors = this.getRecommendationsErrors(entity);
        const comment = errors.join(';');

        if (!errors.length) {
          await this.kycStepRepo.update(...entity.complete());
        } else if (errors.some((e) => KycStepIgnoringErrors.includes(e))) {
          await this.kycStepRepo.update(...entity.ignored(comment));
        } else if (errors.every((e) => [KycError.EXPIRED_RECOMMENDATION, KycError.DENIED_RECOMMENDATION].includes(e))) {
          await this.kycStepRepo.update(...entity.fail(undefined, comment));
        } else {
          await this.kycStepRepo.update(...entity.manualReview(comment));
        }

        await this.createStepLog(entity.userData, entity);

        if (entity.isCompleted) {
          await this.completeRecommendation(entity.userData);
          await this.checkDfxApproval(entity);
        }
      } catch (e) {
        this.logger.error(`Failed to auto review recommendation step ${entity.id}:`, e);
      }
    }
  }

  async checkDfxApproval(kycStep: KycStep): Promise<void> {
    const missingCompletedSteps = requiredKycSteps(kycStep.userData).filter(
      (rs) => !kycStep.userData.hasCompletedStep(rs),
    );

    if (
      (missingCompletedSteps.length === 2 &&
        missingCompletedSteps.every((s) => s === kycStep.name || s === KycStepName.DFX_APPROVAL)) ||
      (missingCompletedSteps.length === 1 &&
        missingCompletedSteps[0] === KycStepName.DFX_APPROVAL &&
        kycStep.name !== KycStepName.DFX_APPROVAL)
    ) {
      const approvalStep = kycStep.userData.kycSteps.find((s) => s.name === KycStepName.DFX_APPROVAL);
      if (approvalStep?.isOnHold) {
        await this.kycStepRepo.update(...approvalStep.manualReview());
      } else if (!approvalStep) {
        const newStep = await this.initiateStep(kycStep.userData, KycStepName.DFX_APPROVAL);
        await this.kycStepRepo.update(...newStep.manualReview());
      }
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
    reviewStatus: ReviewStatus,
  ): Promise<KycStepBase> {
    let user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    if (data.nationality) {
      const nationality = await this.countryService.getCountry(data.nationality.id);
      if (!nationality) throw new BadRequestException('Nationality not found');

      Object.assign(data.nationality, { id: nationality.id, symbol: nationality.symbol });
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

    return this.updateKycStepAndLog(kycStep, user, data, ReviewStatus.MANUAL_REVIEW);
  }

  async updateOperationActivityData(kycHash: string, stepId: number, data: KycOperationalData): Promise<KycStepBase> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    return this.updateKycStepAndLog(kycStep, user, data, ReviewStatus.MANUAL_REVIEW);
  }

  async updateRecommendationData(kycHash: string, stepId: number, data: KycRecommendationData) {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    await this.recommendationService.handleRecommendationRequest(kycStep, user, data.key);

    await this.kycStepRepo.update(...kycStep.internalReview(data));

    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return KycStepMapper.toStepBase(kycStep);
  }

  async updateFileData(
    kycHash: string,
    stepId: number,
    data: KycFileData,
    fileType: FileType,
    urlAsJson = false,
  ): Promise<KycStepBase> {
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

    await this.kycStepRepo.update(...kycStep.manualReview(undefined, urlAsJson ? { url } : url));
    await this.createStepLog(user, kycStep);
    await this.updateProgress(user, false);

    return KycStepMapper.toStepBase(kycStep);
  }

  async updateLegalData(kycHash: string, stepId: number, data: KycLegalEntityData, fileType: FileType) {
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

    await this.kycStepRepo.update(...kycStep.manualReview(undefined, { url, legalEntity: data.legalEntity }));

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

    const complete = FinancialService.isComplete(data.responses, user.accountType);
    if (complete) {
      await this.kycStepRepo.update(...kycStep.internalReview());
      await this.createStepLog(user, kycStep);
    }

    await this.updateProgress(user, false);

    return KycStepMapper.toStepBase(kycStep);
  }

  async updatePaymentData(kycHash: string, stepId: number, data: PaymentDataDto): Promise<KycStepBase> {
    const user = await this.getUser(kycHash);
    const kycStep = user.getPendingStepOrThrow(stepId);

    if (data.contractAccepted) {
      const recipient: PaymentLinkRecipientDto = {
        ...user.paymentLinksConfigObj.recipient,
        name: data.name,
        website: data.website,
        registrationNumber: data.registrationNumber,
        storeType: data.storeType,
        merchantCategory: data.merchantCategory,
        goodsType: data.goodsType,
        goodsCategory: data.goodsCategory,
      };

      await this.userDataService.updatePaymentLinksConfig(user, {
        recipient,
        accessKeys: user.paymentLinksConfigObj.accessKeys ?? [Util.secureRandomString()],
      });

      await this.userDataService.updateUserDataInternal(user, {
        paymentLinksAllowed: true,
        paymentLinksName: data.name,
      });

      await this.kycNotificationService.kycPaymentData(user, new Date());
    }

    return this.updateKycStepAndLog(
      kycStep,
      user,
      data,
      data.contractAccepted ? ReviewStatus.COMPLETED : ReviewStatus.MANUAL_REVIEW,
    );
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

  updateSumsubIdent(dto: SumSubWebhookResult): void {
    const { externalUserId: transactionId } = dto;

    const result = getSumsubResult(dto);
    if (!result) {
      this.logger.info(`Ignoring sumsub webhook call for ${transactionId} due to unknown result: ${dto.type}`);
      return;
    }

    this.logger.info(`Received sumsub webhook call for transaction ${transactionId}: ${result}`);

    // non-blocking update
    this.sumsubService
      .getApplicantData(dto.applicantId)
      .then((data) =>
        this.webhookQueue.handle(() =>
          this.updateIdent(
            IdentType.SUM_SUB,
            transactionId,
            { webhook: dto, data },
            result,
            dto.reviewResult?.rejectLabels,
          ),
        ),
      )
      .catch((e) => this.logger.error(`Error during sumsub webhook update for applicant ${dto.applicantId}:`, e));
  }

  private async updateKycStepAndLog(
    kycStep: KycStep,
    user: UserData,
    data: KycStepResult,
    reviewStatus: ReviewStatus,
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
      accountType: AccountType.PERSONAL,
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
      await this.downloadMedia(user, kycStep, true);
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
        if ([ReviewStatus.EXTERNAL_REVIEW].includes(kycStep.status))
          await this.kycStepRepo.update(...kycStep.inProgress(dto));
        break;

      case IdentShortResult.REVIEW:
        if (!kycStep.isDone) await this.kycStepRepo.update(...kycStep.externalReview());
        break;

      case IdentShortResult.SUCCESS:
        await this.kycStepRepo.update(...kycStep.internalReview(dto));
        await this.downloadIdentDocuments(user, kycStep, true);
        break;

      case IdentShortResult.FAIL:
      case IdentShortResult.RETRY:
        // retrigger personal data step, if data was wrong
        if (reason.includes(SumSubRejectionLabels.PROBLEMATIC_APPLICANT_DATA)) {
          const completedPersonalStep = user.getCompletedStepWith(KycStepName.PERSONAL_DATA);
          if (completedPersonalStep)
            await this.restartStep(user, completedPersonalStep, KycError.PERSONAL_DATA_NOT_MATCHING);
        }

        await this.kycStepRepo.update(
          ...(result === IdentShortResult.FAIL ? kycStep.fail(dto) : kycStep.inProgress(dto)),
        );
        await this.downloadIdentDocuments(user, kycStep, false);
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
        await this.createKycLevelLog(user, nextLevel);
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
      case KycStepName.PERSONAL_DATA:
        return { nextStep: { name: nextStep, preventDirectEvaluation }, nextLevel: KycLevel.LEVEL_10 };

      case KycStepName.NATIONALITY_DATA:
      case KycStepName.OWNER_DIRECTORY:
        return { nextStep: { name: nextStep, preventDirectEvaluation }, nextLevel: KycLevel.LEVEL_20 };

      case KycStepName.CONTACT_DATA:

      case KycStepName.LEGAL_ENTITY:
      case KycStepName.SOLE_PROPRIETORSHIP_CONFIRMATION:
      case KycStepName.SIGNATORY_POWER:
      case KycStepName.BENEFICIAL_OWNER:
      case KycStepName.OPERATIONAL_ACTIVITY:
      case KycStepName.AUTHORITY:
      case KycStepName.FINANCIAL_DATA:
      case KycStepName.ADDITIONAL_DOCUMENTS:
      case KycStepName.RECALL_AGREEMENT:
      case KycStepName.RESIDENCE_PERMIT:
      case KycStepName.STATUTES:
        return { nextStep: { name: nextStep, preventDirectEvaluation } };

      case KycStepName.RECOMMENDATION:
        const recommendationSteps = user.getStepsWith(KycStepName.RECOMMENDATION);
        if (
          (recommendationSteps.some((r) => r.comment?.split(';').includes(KycError.BLOCKED)) ||
            recommendationSteps.length >= Config.kyc.maxRecommendationTries) &&
          !recommendationSteps.some((r) => r.comment?.split(';').includes(KycError.RELEASED))
        )
          return { nextStep: undefined };

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

      case KycStepName.DFX_APPROVAL:
        const approvalSteps = user.getStepsWith(KycStepName.DFX_APPROVAL);
        if (
          (approvalSteps.some((i) => i.comment?.split(';').includes(KycError.BLOCKED)) &&
            !approvalSteps.some((i) => i.comment?.split(';').includes(KycError.RELEASED))) ||
          (lastTry && !lastTry.isFailed && !lastTry.isCanceled)
        )
          return { nextStep: undefined };

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

  private async restartStep(userData: UserData, kycStep: KycStep, comment?: KycError): Promise<void> {
    await this.kycStepRepo.update(
      ...kycStep.fail(undefined, comment ? `${comment};${KycError.RESTARTED_STEP}` : KycError.RESTARTED_STEP),
    );
    await this.initiateStep(userData, kycStep.name, kycStep.type, true);
  }

  // --- HELPER METHODS --- //
  async createKycLevelLog(userData: UserData, newKycLevel: KycLevel): Promise<void> {
    await this.kycLogService.createLogInternal(userData, KycLogType.KYC, `KycLevel changed to ${newKycLevel}`);
  }

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

  async completeReferencedSteps(userData: UserData, referenceStepName: KycStepName): Promise<void> {
    const referenceStep = userData.getStepsWith(referenceStepName).find((k) => k.isInReview);
    if (!referenceStep) throw new BadRequestException(`${referenceStepName} step missing`);

    await this.kycStepRepo.update(...referenceStep.complete());
  }

  async createCustomKycStep(
    userData: UserData,
    stepName: KycStepName,
    status: ReviewStatus,
    result?: unknown,
  ): Promise<KycStep> {
    const nextSequenceNumber = userData.getNextSequenceNumber(stepName);

    const kycStep = this.kycStepRepo.create({
      userData,
      name: stepName,
      status,
      sequenceNumber: nextSequenceNumber,
      result: result ? JSON.stringify(result) : undefined,
    });

    await this.kycStepRepo.save(kycStep);

    return kycStep;
  }

  async getKycStepById(id: number): Promise<KycStep | null> {
    return this.kycStepRepo.findOne({ where: { id }, relations: { userData: true } });
  }

  async saveKycStepUpdate(updateResult: UpdateResult<KycStep>): Promise<void> {
    await this.kycStepRepo.update(...updateResult);
  }

  async completeIdent(
    kycStep: KycStep,
    nationality?: Country,
    nationalityStepData?: KycNationalityData,
  ): Promise<void> {
    const data = kycStep.resultData;
    const userData = kycStep.userData;
    const identificationType = getIdentificationType(data.type, data.kycType);
    nationality ??= nationalityStepData?.nationality?.id
      ? await this.countryService.getCountry(nationalityStepData.nationality.id)
      : data.nationality
        ? await this.countryService.getCountryWithSymbol(data.nationality)
        : null;

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
            identificationType === KycIdentificationType.VIDEO_ID || kycStep.type === KycStepType.MANUAL
              ? CheckStatus.UNNECESSARY
              : undefined,
          identDocumentType: data.documentType,
          identDocumentId: kycStep.identDocumentId,
          olkypayAllowed: userData.olkypayAllowed ?? true,
          nationality,
        });
        await this.createKycLevelLog(userData, KycLevel.LEVEL_30);

        if (kycStep.isValidCreatingBankData && !DisabledProcess(Process.AUTO_CREATE_BANK_DATA))
          await this.bankDataService.createBankDataInternal(kycStep.userData, {
            name: kycStep.userName,
            iban: `Ident${kycStep.identDocumentId}`,
            type: BankDataType.IDENT,
          });

        return;
      } else {
        await this.kycStepRepo.update(
          ...kycStep.fail(undefined, [kycStep.comment, KycError.NATIONALITY_MISSING].filter((c) => c).join(';')),
        );
      }
    }

    this.logger.error(`Missing ident data for userData ${userData.id}`);
  }

  async completeFinancialData(kycStep: KycStep): Promise<void> {
    if (![KycLevel.LEVEL_30, KycLevel.LEVEL_40].includes(kycStep.userData.kycLevel)) {
      const message = `KycStep FinancialData for userData ${kycStep.userData.id} cannot be completed with kycLevel ${kycStep.userData.kycLevel}`;

      this.logger.error(message);
      throw new Error(message);
    }

    await this.userDataService.updateUserDataInternal(kycStep.userData, { kycLevel: KycLevel.LEVEL_40 });
    await this.createKycLevelLog(kycStep.userData, KycLevel.LEVEL_40);
  }

  async completeRecommendation(userData: UserData): Promise<void> {
    await this.userDataService.updateUserDataInternal(userData, { tradeApprovalDate: new Date() });
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

  private getFinancialDataErrors(entity: KycStep): KycError[] {
    const errors = this.getStepDefaultErrors(entity);
    const financialStepResult = entity.getResult<KycFinancialResponse[]>();

    if (!FinancialService.isComplete(financialStepResult, entity.userData.accountType))
      errors.push(KycError.MISSING_RESPONSE);
    if (!financialStepResult.some((f) => f.key === 'risky_business' && f.value.includes('no')))
      errors.push(KycError.RISKY_BUSINESS);

    return errors;
  }

  private getRecommendationsErrors(entity: KycStep): KycError[] {
    const errors = this.getStepDefaultErrors(entity);

    if (entity.recommendation.isConfirmed === null && entity.recommendation.isExpired)
      errors.push(KycError.EXPIRED_RECOMMENDATION);
    if (entity.recommendation.isConfirmed === false) errors.push(KycError.DENIED_RECOMMENDATION);
    if (entity.recommendation.recommender.isBlocked) errors.push(KycError.RECOMMENDER_BLOCKED);

    return errors;
  }

  private getIdentCheckErrors(
    identStep: KycStep,
    nationalityStep: KycStep,
    data: IdentResultData,
    nationality?: Country,
    ipCountry?: Country,
    country?: Country,
  ): KycError[] {
    const errors = this.getStepDefaultErrors(identStep);
    const nationalityStepResult = nationalityStep.getResult<{ nationality: IEntity }>();

    // IP check
    if (
      ipCountry &&
      identStep.userData.users?.some(
        (u) =>
          u.ipCountry !== ipCountry.symbol &&
          ![u.ipCountry, ipCountry.symbol].every((c) => Config.allowedBorderRegions.includes(c)),
      )
    )
      errors.push(KycError.IP_COUNTRY_MISMATCH);
    if (
      country &&
      identStep.userData.users?.some(
        (u) =>
          u.ipCountry !== country.symbol &&
          ![u.ipCountry, country.symbol].every((c) => Config.allowedBorderRegions.includes(c)),
      )
    )
      errors.push(KycError.COUNTRY_IP_COUNTRY_MISMATCH);

    // Name check
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

    // Nationality check
    if (!nationality) {
      errors.push(KycError.NATIONALITY_MISSING);
    } else {
      if (
        !nationalityStepResult ||
        (NationalityDocType.includes(data.documentType) && nationalityStepResult.nationality.id !== nationality?.id)
      )
        errors.push(KycError.NATIONALITY_NOT_MATCHING);
      if (!nationality.isKycDocEnabled(data.documentType)) errors.push(KycError.DOCUMENT_TYPE_NOT_ALLOWED);
      if (!nationality.nationalityEnable) errors.push(KycError.NATIONALITY_NOT_ALLOWED);
    }

    // Ident doc check
    if (!ValidDocType.includes(data.documentType)) errors.push(KycError.INVALID_DOCUMENT_TYPE);
    if (!data.documentNumber) errors.push(KycError.IDENTIFICATION_NUMBER_MISSING);
    if (!data.success) errors.push(KycError.INVALID_RESULT);

    // Country & verifiedName check
    const userCountry =
      identStep.userData.organizationCountry ?? identStep.userData.verifiedCountry ?? identStep.userData.country;
    if (identStep.userData.accountType === AccountType.PERSONAL) {
      // Personal Account
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
      // Business Account
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
    return this.userDataService.getByKycHashOrThrow(kycHash, {
      users: true,
      kycSteps: { userData: true },
      wallet: true,
    });
  }

  private async getUserByTransactionOrThrow(
    transactionId: string,
    data: any,
  ): Promise<{ user: UserData; stepId: number }> {
    const kycStep = await this.kycStepRepo.findOne({
      where: { transactionId },
      relations: { userData: { wallet: true } },
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

  private async downloadIdentDocuments(user: UserData, kycStep: KycStep, isValid: boolean) {
    const documents = await this.sumsubService.getDocuments(kycStep);
    await this.storeDocuments(documents, user, kycStep, isValid);
  }

  private async downloadMedia(user: UserData, kycStep: KycStep, isValid: boolean) {
    const documents = await this.sumsubService.getMedia(kycStep);
    await this.storeDocuments(documents, user, kycStep, isValid);
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
    await this.storeDocuments(missingDocuments, kycStep.userData, kycStep, true);
  }

  private async storeDocuments(
    documents: IdentDocument[],
    user: UserData,
    kycStep: KycStep,
    isValid: boolean,
  ): Promise<void> {
    for (const { name, content, contentType, fileSubType } of documents) {
      await this.documentService.uploadFile(
        user,
        FileType.IDENTIFICATION,
        `${isValid ? '' : 'fail/'}${name}`,
        content,
        contentType,
        true,
        isValid,
        kycStep,
        fileSubType,
      );
    }
  }
}
