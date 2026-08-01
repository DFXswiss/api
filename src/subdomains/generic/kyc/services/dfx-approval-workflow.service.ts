import { Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Between, EntityManager, In, IsNull, MoreThanOrEqual, Not } from 'typeorm';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycLevel, KycStatus, KycType, UserDataStatus } from '../../user/models/user-data/user-data.enum';
import { FileSubType } from '../dto/kyc-file.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { NameCheckLog, NameCheckRiskStatus } from '../entities/name-check-log.entity';
import { StepLog } from '../entities/step-log.entity';
import { KycStepName } from '../enums/kyc-step-name.enum';
import { KycLogType } from '../enums/kyc.enum';
import { ReviewStatus } from '../enums/review-status.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { DfxApprovalCheckService } from './dfx-approval-check.service';
import { DfxApprovalDocumentService } from './dfx-approval-document.service';
import { KycLogService } from './kyc-log.service';
import { KycNotificationService } from './kyc-notification.service';
import { NameCheckService } from './name-check.service';

// Separate advisory-lock namespaces: step IDs and user data IDs are independent sequences and must
// not collide in the same lock space.
const STEP_ADVISORY_LOCK_NAMESPACE = 1145466968;
const USER_DATA_ADVISORY_LOCK_NAMESPACE = 1145466969;

// Accounts excluded from generated GwG documents, kept out of the source tree because they are
// productive account IDs. Empty unless the setting is present.
export const DOCUMENT_EXCLUSION_SETTING_KEY = 'dfxApprovalDocumentExclusions';

// Lock aliases must be lower case: TypeORM emits `FOR UPDATE OF <alias>` unquoted and Postgres
// folds unquoted identifiers to lower case, so a camelCase alias is not found in the FROM clause.
const STEP_LOCK_ALIAS = 'step';
const USER_DATA_LOCK_ALIAS = 'user_data';

@Injectable()
export class DfxApprovalWorkflowService {
  private readonly logger = new DfxLogger(DfxApprovalWorkflowService);

  constructor(
    private readonly kycStepRepo: KycStepRepository,
    private readonly checkService: DfxApprovalCheckService,
    private readonly documentService: DfxApprovalDocumentService,
    private readonly nameCheckService: NameCheckService,
    private readonly notificationService: KycNotificationService,
    private readonly settingService: SettingService,
    private readonly logService: KycLogService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.KYC_DFX_APPROVAL, timeout: 900 })
  async reviewPersonalApprovals(): Promise<void> {
    if (!Config.kyc.dfxApprovalWorkflowEnabled) return;

    const exclusions = await this.documentExclusions();

    await this.initializePendingPersonalRiskData();

    const steps = await this.kycStepRepo.find({
      where: {
        name: KycStepName.DFX_APPROVAL,
        status: ReviewStatus.MANUAL_REVIEW,
        userData: { accountType: AccountType.PERSONAL, kycLevel: MoreThanOrEqual(KycLevel.LEVEL_40) },
      },
      order: { created: 'ASC' },
      take: 50,
    });

    for (const step of steps) {
      try {
        await this.withStepLock(step.id, () => this.processPersonalApproval(step.id));
      } catch (error) {
        this.logger.error(`DfxApproval workflow failed for step ${step.id}:`, error);
      }
    }

    await this.generatePendingPersonalDocuments(exclusions);
  }

  // Productive account IDs stay in configuration, never in the source tree.
  private async documentExclusions(): Promise<number[]> {
    return (await this.settingService.getObjCached<number[]>(DOCUMENT_EXCLUSION_SETTING_KEY, [])) ?? [];
  }

  private async processPersonalApproval(stepId: number): Promise<void> {
    let step = await this.loadStep(stepId);
    if (step.status !== ReviewStatus.MANUAL_REVIEW || step.userData.kycLevel < KycLevel.LEVEL_40) return;

    const hasOpenNameChecks = await this.nameCheckService.hasOpenNameChecks(step.userData);
    await this.initializePersonalRiskData(step.userData, hasOpenNameChecks);

    step = await this.loadStep(stepId);
    const requestedDocuments = this.eligiblePersonalDocuments(step.userData);
    await this.documentService.generateMissingPersonalDocuments(
      step.userData,
      step,
      step.userData.kycFiles,
      requestedDocuments,
    );

    const completedUser = await this.completeIfReady(stepId);
    if (completedUser) await this.notificationService.kycChanged(completedUser, completedUser.kycLevel);
  }

  private async initializePersonalRiskData(userData: UserData, hasOpenNameChecks: boolean): Promise<void> {
    if (!userData.hasValidNameCheckDate || hasOpenNameChecks) return;

    const update: Partial<UserData> = {};
    if (userData.pep == null) update.pep = false;
    if (userData.highRisk == null) update.highRisk = false;
    if (userData.complexOrgStructure == null) update.complexOrgStructure = false;
    if (userData.depositLimit == null) update.depositLimit = 100000;
    if (!Object.keys(update).length) return;

    await this.kycStepRepo.manager.transaction(async (manager) => {
      const current = await this.lockUserData(manager, userData.id);
      if (!current) throw new NotFoundException('UserData not found');

      const effectiveUpdate = Object.fromEntries(
        Object.entries(update).filter(([key]) => current[key as keyof UserData] == null),
      ) as Partial<UserData>;
      if (!Object.keys(effectiveUpdate).length) return;

      await this.logService.createLogInternal(
        current,
        KycLogType.KYC,
        JSON.stringify({
          workflow: 'DfxApproval',
          action: 'InitializePersonalRiskData',
          before: Object.fromEntries(Object.keys(effectiveUpdate).map((key) => [key, current[key as keyof UserData]])),
          after: effectiveUpdate,
        }),
        manager,
      );
      await manager.update(UserData, current.id, effectiveUpdate);
    });
  }

  private async initializePendingPersonalRiskData(): Promise<void> {
    const users = await this.kycStepRepo.manager.find(UserData, {
      where: {
        accountType: AccountType.PERSONAL,
        highRisk: IsNull(),
        lastNameCheckDate: Not(IsNull()),
        kycLevel: MoreThanOrEqual(KycLevel.LEVEL_30),
      },
      order: { id: 'ASC' },
      take: 50,
    });

    for (const userData of users) {
      try {
        // A new sanctioned hit does not refresh `lastNameCheckDate` (that only happens on a clean
        // result), so a still-valid date is no proof that no check is open. Ask for it.
        const hasOpenNameChecks = await this.nameCheckService.hasOpenNameChecks(userData);
        await this.initializePersonalRiskData(userData, hasOpenNameChecks);
      } catch (error) {
        this.logger.error(`DfxApproval risk initialization failed for userData ${userData.id}:`, error);
      }
    }
  }

  private async generatePendingPersonalDocuments(exclusions: number[]): Promise<void> {
    await this.generatePendingApprovalStepDocuments();
    await this.generatePendingCustomerProfiles();
    await this.generatePendingRiskAndFormADocuments(exclusions);
  }

  private async generatePendingApprovalStepDocuments(): Promise<void> {
    const steps = await this.kycStepRepo.find({
      where: {
        name: KycStepName.DFX_APPROVAL,
        status: In([ReviewStatus.INTERNAL_REVIEW, ReviewStatus.MANUAL_REVIEW]),
        userData: { accountType: AccountType.PERSONAL, verifiedName: Not(IsNull()) },
      },
      relations: { userData: true },
      order: { created: 'DESC' },
      take: 500,
    });

    for (const candidate of steps) {
      try {
        await this.withStepLock(candidate.id, async () => {
          const step = await this.loadStep(candidate.id);
          const requested = this.eligibleApprovalStepDocuments(step.userData);
          await this.documentService.generateMissingPersonalDocuments(
            step.userData,
            step,
            step.userData.kycFiles,
            requested,
          );
        });
      } catch (error) {
        this.logger.error(`DfxApproval step document generation failed for step ${candidate.id}:`, error);
      }
    }
  }

  private async generatePendingCustomerProfiles(): Promise<void> {
    const steps = await this.kycStepRepo.find({
      where: {
        name: KycStepName.FINANCIAL_DATA,
        status: ReviewStatus.COMPLETED,
        userData: {
          accountType: AccountType.PERSONAL,
          kycLevel: Between(KycLevel.LEVEL_30, KycLevel.LEVEL_40),
          verifiedName: Not(IsNull()),
        },
      },
      relations: { userData: true },
      order: { created: 'DESC' },
      take: 500,
    });

    for (const step of steps) {
      try {
        await this.withStepLock(step.id, async () => {
          const userData = await this.loadUserData(this.kycStepRepo.manager, step.userData.id);
          await this.documentService.generateMissingPersonalDocuments(userData, step, userData.kycFiles, [
            FileSubType.CUSTOMER_PROFILE,
          ]);
        });
      } catch (error) {
        this.logger.error(`DfxApproval customer profile generation failed for step ${step.id}:`, error);
      }
    }
  }

  private async generatePendingRiskAndFormADocuments(exclusions: number[]): Promise<void> {
    const users = await this.kycStepRepo.manager.find(UserData, {
      where: {
        ...(exclusions.length ? { id: Not(In(exclusions)) } : {}),
        accountType: AccountType.PERSONAL,
        status: Not(UserDataStatus.MERGED),
        kycType: KycType.DFX,
        kycLevel: Between(KycLevel.LEVEL_30, KycLevel.LEVEL_40),
      },
      relations: {
        country: true,
        verifiedCountry: true,
        nationality: true,
        language: true,
        wallet: true,
        kycSteps: true,
        kycFiles: { kycStep: true },
      },
      order: { created: 'DESC' },
      take: 500,
    });

    for (const userData of users) {
      const requested = this.eligibleRiskAndFormADocuments(userData, exclusions);

      try {
        // These two documents follow the account, not a KYC step. Locking on the user data keeps
        // accounts without a DfxApproval or FinancialData step in scope, which the productive Sheet
        // covers as well.
        await this.withUserDataLock(userData.id, () =>
          this.documentService.generateMissingPersonalDocuments(
            userData,
            this.documentAnchorStep(userData),
            userData.kycFiles,
            requested,
          ),
        );
      } catch (error) {
        this.logger.error(`DfxApproval risk/FormA generation failed for userData ${userData.id}:`, error);
      }
    }
  }

  // Optional: only used to reference the triggering step in the document metadata.
  private documentAnchorStep(userData: UserData): KycStep | undefined {
    return [...(userData.kycSteps ?? [])]
      .filter((step) => [KycStepName.DFX_APPROVAL, KycStepName.FINANCIAL_DATA].includes(step.name))
      .sort((a, b) => b.created.getTime() - a.created.getTime())[0];
  }

  // Step-bound documents only. RiskProfile and FormA belong to the account and are generated under
  // the user-data lock in `generatePendingRiskAndFormADocuments`; generating them from here as well
  // would let two instances write the same document under two different lock keys.
  private eligiblePersonalDocuments(userData: UserData): FileSubType[] {
    const documents = this.eligibleApprovalStepDocuments(userData);
    const isPreApprovalPersonal =
      userData.accountType === AccountType.PERSONAL &&
      userData.kycLevel >= KycLevel.LEVEL_30 &&
      userData.kycLevel < KycLevel.LEVEL_50;
    const hasFinancialData = userData.kycSteps?.some(
      (step) => step.name === KycStepName.FINANCIAL_DATA && step.isCompleted,
    );
    if (isPreApprovalPersonal && userData.verifiedName && hasFinancialData)
      documents.push(FileSubType.CUSTOMER_PROFILE);

    return [...new Set(documents)];
  }

  private eligibleApprovalStepDocuments(userData: UserData): FileSubType[] {
    const documents: FileSubType[] = [];
    if (userData.verifiedName) documents.push(FileSubType.GWG_FILE_COVER);
    if (userData.status !== UserDataStatus.MERGED && userData.nationality)
      documents.push(FileSubType.IDENTIFICATION_FORM);
    if (userData.status !== UserDataStatus.MERGED && userData.verifiedName) documents.push(FileSubType.DFX_NAME_CHECK);
    return documents;
  }

  private eligibleRiskAndFormADocuments(userData: UserData, exclusions: number[]): FileSubType[] {
    const eligible =
      userData.accountType === AccountType.PERSONAL &&
      userData.status !== UserDataStatus.MERGED &&
      userData.kycType === KycType.DFX &&
      userData.kycLevel >= KycLevel.LEVEL_30 &&
      userData.kycLevel < KycLevel.LEVEL_50 &&
      !exclusions.includes(userData.id);
    if (!eligible) return [];

    const documents = [FileSubType.FORM_A];
    if (userData.highRisk === false && userData.country?.fatfEnable === true) documents.push(FileSubType.RISK_PROFILE);
    return documents;
  }

  private async completeIfReady(stepId: number): Promise<UserData | undefined> {
    return this.kycStepRepo.manager.transaction(async (manager) => {
      const step = await this.lockStep(manager, stepId);
      if (!step || step.status !== ReviewStatus.MANUAL_REVIEW) return undefined;

      const userData = await this.loadUserData(manager, step.userData.id);
      step.userData = userData;
      const hasOpenNameChecks = await manager.exists(NameCheckLog, {
        where: {
          userData: { id: userData.id },
          riskEvaluation: IsNull(),
          riskStatus: NameCheckRiskStatus.SANCTIONED,
        },
      });
      const status = this.checkService.evaluatePersonal(userData, step, userData.kycFiles, hasOpenNameChecks);
      if (!status.ready) {
        // The gate decision is the operational signal of this workflow: without the blockers, a case
        // waiting forever is indistinguishable from a case nobody looked at.
        this.logger.verbose(
          `DfxApproval step ${step.id} not ready: ${status.blockers
            .map((blocker) => blocker.code + (blocker.documentSubType ? `(${blocker.documentSubType})` : ''))
            .join(', ')}`,
        );
        return undefined;
      }

      const result = JSON.stringify({
        workflow: 'DfxApproval',
        mode: 'Automatic',
        version: 'v1',
        completedAt: new Date().toISOString(),
        complianceReview: {
          complexOrgStructure: 'Nein',
          highRisk: 'Nein',
          depositLimit: '100000',
          amlAccountType: 'natural person',
          processedBy: 'DFX API',
          finalDecision: 'Akzeptiert',
        },
      });
      const finalKycLevel = Math.max(userData.kycLevel, KycLevel.LEVEL_50);

      // Every column this transaction overwrites is recorded with its previous value first, so the
      // prior state stays reconstructible from the database alone.
      await this.logService.createLogInternal(
        userData,
        KycLogType.KYC,
        JSON.stringify({
          workflow: 'DfxApproval',
          action: 'AutomaticApproval',
          before: {
            stepStatus: step.status,
            kycLevel: userData.kycLevel,
            kycStatus: userData.kycStatus,
            complexOrgStructure: userData.complexOrgStructure,
            highRisk: userData.highRisk,
            depositLimit: userData.depositLimit,
            amlAccountType: userData.amlAccountType,
          },
          after: {
            stepStatus: ReviewStatus.COMPLETED,
            kycLevel: finalKycLevel,
            kycStatus: KycStatus.COMPLETED,
            complexOrgStructure: false,
            highRisk: false,
            depositLimit: 100000,
            amlAccountType: 'natural person',
          },
        }),
        manager,
      );

      const [stepId_, stepUpdate] = step.complete(result);
      await manager.update(KycStep, stepId_, { ...stepUpdate, comment: null });
      await manager.save(
        manager.create(StepLog, {
          type: KycLogType.STEP,
          userData: { id: userData.id },
          kycStep: { id: step.id },
          status: ReviewStatus.COMPLETED,
          result,
        }),
      );
      const userStatusUpdate = {
        ...(userData.kycLevel < KycLevel.LEVEL_50 ? { kycLevel: KycLevel.LEVEL_50 } : {}),
        kycStatus: KycStatus.COMPLETED,
        complexOrgStructure: false,
        highRisk: false,
        depositLimit: 100000,
        amlAccountType: 'natural person',
      };
      await manager.update(UserData, userData.id, userStatusUpdate);
      // Same wording as the manual approval path (KycService.createKycLevelLog), so existing log
      // evaluations keep matching.
      await this.logService.createLogInternal(
        userData,
        KycLogType.KYC,
        `KycLevel changed to ${finalKycLevel}`,
        manager,
      );

      Object.assign(userData, userStatusUpdate);
      return userData;
    });
  }

  // Row lock for the approval transaction. The step is joined to its user data because a
  // `ManyToOne` without `eager` is not populated by a plain load, and the completion needs the
  // user data ID. `FOR UPDATE OF` names the step alone: Postgres rejects `FOR UPDATE` on the
  // nullable side of an outer join, and the user data is only read here, never written.
  private async lockStep(manager: EntityManager, stepId: number): Promise<KycStep | undefined> {
    return manager
      .createQueryBuilder(KycStep, STEP_LOCK_ALIAS)
      .leftJoinAndSelect(`${STEP_LOCK_ALIAS}.userData`, 'joinedUserData')
      .where(`${STEP_LOCK_ALIAS}.id = :stepId`, { stepId })
      .setLock('pessimistic_write', undefined, [STEP_LOCK_ALIAS])
      .getOne()
      .then((step) => step ?? undefined);
  }

  // Row lock on user data only. A find with relations would join the eager, nullable relations of
  // `UserData` (country, verifiedCountry, organization), which Postgres refuses to lock.
  private async lockUserData(manager: EntityManager, userDataId: number): Promise<UserData | undefined> {
    return manager
      .createQueryBuilder(UserData, USER_DATA_LOCK_ALIAS)
      .where(`${USER_DATA_LOCK_ALIAS}.id = :userDataId`, { userDataId })
      .setLock('pessimistic_write', undefined, [USER_DATA_LOCK_ALIAS])
      .getOne()
      .then((userData) => userData ?? undefined);
  }

  private async loadStep(stepId: number): Promise<KycStep> {
    const step = await this.kycStepRepo.findOne({
      where: { id: stepId },
      relations: {
        userData: {
          country: true,
          verifiedCountry: true,
          nationality: true,
          language: true,
          wallet: true,
          kycSteps: true,
          kycFiles: { kycStep: true },
        },
      },
    });
    if (!step) throw new NotFoundException('DfxApproval step not found');
    return step;
  }

  private async loadUserData(manager: EntityManager, userDataId: number): Promise<UserData> {
    const userData = await manager.findOne(UserData, {
      where: { id: userDataId },
      relations: {
        country: true,
        verifiedCountry: true,
        nationality: true,
        language: true,
        wallet: true,
        kycSteps: true,
        kycFiles: { kycStep: true },
      },
    });
    if (!userData) throw new NotFoundException('UserData not found');
    return userData;
  }

  private async withStepLock(stepId: number, action: () => Promise<void>): Promise<void> {
    return this.withAdvisoryLock(STEP_ADVISORY_LOCK_NAMESPACE, stepId, action);
  }

  private async withUserDataLock(userDataId: number, action: () => Promise<void>): Promise<void> {
    return this.withAdvisoryLock(USER_DATA_ADVISORY_LOCK_NAMESPACE, userDataId, action);
  }

  private async withAdvisoryLock(namespace: number, key: number, action: () => Promise<void>): Promise<void> {
    const runner = this.kycStepRepo.manager.connection.createQueryRunner();
    await runner.connect();
    let acquired = false;
    try {
      const rows = (await runner.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [namespace, key])) as {
        acquired: boolean;
      }[];
      acquired = rows[0]?.acquired === true;

      if (acquired) await action();
    } finally {
      if (acquired) await runner.query('SELECT pg_advisory_unlock($1, $2)', [namespace, key]);
      await runner.release();
    }
  }
}
