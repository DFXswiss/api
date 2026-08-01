import { Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Between, EntityManager, In, IsNull, MoreThanOrEqual, Not } from 'typeorm';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycLevel, KycStatus, KycType, UserDataStatus } from '../../user/models/user-data/user-data.enum';
import { FileSubType } from '../dto/kyc-file.dto';
import { KycLog } from '../entities/kyc-log.entity';
import { KycStep } from '../entities/kyc-step.entity';
import { NameCheckLog, NameCheckRiskStatus } from '../entities/name-check-log.entity';
import { StepLog } from '../entities/step-log.entity';
import { KycStepName } from '../enums/kyc-step-name.enum';
import { KycLogType } from '../enums/kyc.enum';
import { ReviewStatus } from '../enums/review-status.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { DfxApprovalCheckService } from './dfx-approval-check.service';
import { DfxApprovalDocumentService } from './dfx-approval-document.service';
import { KycNotificationService } from './kyc-notification.service';
import { NameCheckService } from './name-check.service';

const ADVISORY_LOCK_NAMESPACE = 1145466968;
const LEGACY_DOCUMENT_EXCLUSIONS = [374462, 374428, 385169];

@Injectable()
export class DfxApprovalWorkflowService {
  private readonly logger = new DfxLogger(DfxApprovalWorkflowService);

  constructor(
    private readonly kycStepRepo: KycStepRepository,
    private readonly checkService: DfxApprovalCheckService,
    private readonly documentService: DfxApprovalDocumentService,
    private readonly nameCheckService: NameCheckService,
    private readonly notificationService: KycNotificationService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.KYC_DFX_APPROVAL, timeout: 900 })
  async reviewPersonalApprovals(): Promise<void> {
    if (!Config.kyc.dfxApprovalWorkflowEnabled) return;

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

    await this.generatePendingPersonalDocuments();
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
      const current = await manager.findOne(UserData, {
        where: { id: userData.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw new NotFoundException('UserData not found');

      const effectiveUpdate = Object.fromEntries(
        Object.entries(update).filter(([key]) => current[key as keyof UserData] == null),
      ) as Partial<UserData>;
      if (!Object.keys(effectiveUpdate).length) return;

      await manager.save(
        manager.create(KycLog, {
          type: KycLogType.KYC,
          userData: { id: current.id },
          result: JSON.stringify({
            workflow: 'DfxApproval',
            action: 'InitializePersonalRiskData',
            before: Object.fromEntries(
              Object.keys(effectiveUpdate).map((key) => [key, current[key as keyof UserData]]),
            ),
            after: effectiveUpdate,
          }),
        }),
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
        await this.initializePersonalRiskData(userData, false);
      } catch (error) {
        this.logger.error(`DfxApproval risk initialization failed for userData ${userData.id}:`, error);
      }
    }
  }

  private async generatePendingPersonalDocuments(): Promise<void> {
    await this.generatePendingApprovalStepDocuments();
    await this.generatePendingCustomerProfiles();
    await this.generatePendingRiskAndFormADocuments();
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

  private async generatePendingRiskAndFormADocuments(): Promise<void> {
    const users = await this.kycStepRepo.manager.find(UserData, {
      where: {
        id: Not(In(LEGACY_DOCUMENT_EXCLUSIONS)),
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
      const step = this.documentAnchorStep(userData);
      if (!step) continue;
      const requested = this.eligibleRiskAndFormADocuments(userData);

      try {
        await this.withStepLock(step.id, () =>
          this.documentService.generateMissingPersonalDocuments(userData, step, userData.kycFiles, requested),
        );
      } catch (error) {
        this.logger.error(`DfxApproval risk/FormA generation failed for userData ${userData.id}:`, error);
      }
    }
  }

  private documentAnchorStep(userData: UserData): KycStep | undefined {
    return [...(userData.kycSteps ?? [])]
      .filter((step) => [KycStepName.DFX_APPROVAL, KycStepName.FINANCIAL_DATA].includes(step.name))
      .sort((a, b) => b.created.getTime() - a.created.getTime())[0];
  }

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
    documents.push(...this.eligibleRiskAndFormADocuments(userData));
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

  private eligibleRiskAndFormADocuments(userData: UserData): FileSubType[] {
    const eligible =
      userData.accountType === AccountType.PERSONAL &&
      userData.status !== UserDataStatus.MERGED &&
      userData.kycType === KycType.DFX &&
      userData.kycLevel >= KycLevel.LEVEL_30 &&
      userData.kycLevel < KycLevel.LEVEL_50 &&
      !LEGACY_DOCUMENT_EXCLUSIONS.includes(userData.id);
    if (!eligible) return [];

    const documents = [FileSubType.FORM_A];
    if (userData.highRisk === false && userData.country?.fatfEnable === true) documents.push(FileSubType.RISK_PROFILE);
    return documents;
  }

  private async completeIfReady(stepId: number): Promise<UserData | undefined> {
    return this.kycStepRepo.manager.transaction(async (manager) => {
      const step = await manager.findOne(KycStep, {
        where: { id: stepId },
        lock: { mode: 'pessimistic_write' },
      });
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
      if (!status.ready) return undefined;

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

      await manager.save(
        manager.create(KycLog, {
          type: KycLogType.KYC,
          userData: { id: userData.id },
          result: JSON.stringify({
            workflow: 'DfxApproval',
            action: 'AutomaticApproval',
            before: { stepStatus: step.status, kycLevel: userData.kycLevel, kycStatus: userData.kycStatus },
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
        }),
      );
      await manager.update(KycStep, step.id, { status: ReviewStatus.COMPLETED, result, comment: null });
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
      await manager.save(
        manager.create(KycLog, {
          type: KycLogType.KYC,
          userData: { id: userData.id },
          result: `KycLevel confirmed at ${finalKycLevel} by DfxApproval API workflow`,
        }),
      );

      Object.assign(userData, userStatusUpdate);
      return userData;
    });
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

  private async withStepLock(stepId: number, action: () => Promise<void>, wait = false): Promise<void> {
    const runner = this.kycStepRepo.manager.connection.createQueryRunner();
    await runner.connect();
    let acquired = false;
    try {
      if (wait) {
        await runner.query('SELECT pg_advisory_lock($1, $2)', [ADVISORY_LOCK_NAMESPACE, stepId]);
        acquired = true;
      } else {
        const rows = (await runner.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [
          ADVISORY_LOCK_NAMESPACE,
          stepId,
        ])) as { acquired: boolean }[];
        acquired = rows[0]?.acquired === true;
      }
      if (acquired) await action();
    } finally {
      if (acquired) await runner.query('SELECT pg_advisory_unlock($1, $2)', [ADVISORY_LOCK_NAMESPACE, stepId]);
      await runner.release();
    }
  }
}
