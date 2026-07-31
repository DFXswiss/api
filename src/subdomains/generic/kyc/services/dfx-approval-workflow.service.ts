import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { EntityManager, IsNull } from 'typeorm';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycLevel, KycStatus } from '../../user/models/user-data/user-data.enum';
import { DfxApprovalBlocker, DfxApprovalStatusDto } from '../dto/output/dfx-approval-status.dto';
import { KycLog } from '../entities/kyc-log.entity';
import { KycStep } from '../entities/kyc-step.entity';
import { NameCheckLog, NameCheckRiskStatus } from '../entities/name-check-log.entity';
import { StepLog } from '../entities/step-log.entity';
import { KycStepName } from '../enums/kyc-step-name.enum';
import { KycLogType } from '../enums/kyc.enum';
import { ReviewStatus } from '../enums/review-status.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { DFX_APPROVAL_REQUIRED_DOCUMENTS, DfxApprovalCheckService } from './dfx-approval-check.service';
import { DfxApprovalDocumentService } from './dfx-approval-document.service';
import { KycNotificationService } from './kyc-notification.service';
import { NameCheckService } from './name-check.service';

const ADVISORY_LOCK_NAMESPACE = 1145466968;

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

    const steps = await this.kycStepRepo.find({
      where: {
        name: KycStepName.DFX_APPROVAL,
        status: ReviewStatus.MANUAL_REVIEW,
        userData: { accountType: AccountType.PERSONAL, kycLevel: KycLevel.LEVEL_40 },
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
  }

  async getStatus(stepId: number): Promise<DfxApprovalStatusDto> {
    const step = await this.loadStep(stepId);
    const hasOpenNameChecks = await this.nameCheckService.hasOpenNameChecks(step.userData);
    return this.checkService.evaluatePersonal(step.userData, step, step.userData.kycFiles, hasOpenNameChecks);
  }

  async applyManualDecision(
    stepId: number,
    actorUserDataId: number,
    status: ReviewStatus.COMPLETED | ReviewStatus.FAILED,
    result: string,
    comment: string | undefined,
    userDataUpdate: Pick<UserData, 'complexOrgStructure' | 'highRisk' | 'depositLimit' | 'amlAccountType'>,
  ): Promise<void> {
    await this.withStepLock(
      stepId,
      () => this.applyManualDecisionTransaction(stepId, actorUserDataId, status, result, comment, userDataUpdate),
      true,
    );
  }

  private async applyManualDecisionTransaction(
    stepId: number,
    actorUserDataId: number,
    status: ReviewStatus.COMPLETED | ReviewStatus.FAILED,
    result: string,
    comment: string | undefined,
    userDataUpdate: Pick<UserData, 'complexOrgStructure' | 'highRisk' | 'depositLimit' | 'amlAccountType'>,
  ): Promise<void> {
    const completedUser = await this.kycStepRepo.manager.transaction(async (manager) => {
      const step = await manager.findOne(KycStep, {
        where: { id: stepId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!step || step.name !== KycStepName.DFX_APPROVAL) throw new NotFoundException('DfxApproval step not found');
      if (step.status !== ReviewStatus.MANUAL_REVIEW)
        throw new BadRequestException(`DfxApproval step is not in ${ReviewStatus.MANUAL_REVIEW}`);

      const userData = await this.loadUserData(manager, step.userData.id);
      if (status === ReviewStatus.COMPLETED) {
        const missingDocuments = DFX_APPROVAL_REQUIRED_DOCUMENTS.filter(
          (subType) => !userData.kycFiles.some((file) => file.valid && file.subType === subType),
        );
        if (missingDocuments.length)
          throw new BadRequestException(`Required DfxApproval documents are missing: ${missingDocuments.join(', ')}`);

        const hasOpenNameChecks = await manager.exists(NameCheckLog, {
          where: {
            userData: { id: userData.id },
            riskEvaluation: IsNull(),
            riskStatus: NameCheckRiskStatus.SANCTIONED,
          },
        });
        if (hasOpenNameChecks) throw new BadRequestException('Open sanctioned name check');
      }

      const before = {
        stepStatus: step.status,
        kycLevel: userData.kycLevel,
        kycStatus: userData.kycStatus,
        complexOrgStructure: userData.complexOrgStructure,
        highRisk: userData.highRisk,
        depositLimit: userData.depositLimit,
        amlAccountType: userData.amlAccountType,
      };
      const userStatusUpdate =
        status === ReviewStatus.COMPLETED
          ? { ...userDataUpdate, kycLevel: KycLevel.LEVEL_50, kycStatus: KycStatus.COMPLETED }
          : userDataUpdate;

      await manager.save(
        manager.create(KycLog, {
          type: KycLogType.MANUAL,
          userData: { id: userData.id },
          result: JSON.stringify({
            workflow: 'DfxApproval',
            action: 'ManualDecision',
            actorUserDataId,
            before,
            after: { ...userStatusUpdate, stepStatus: status },
          }),
        }),
      );
      await manager.update(UserData, userData.id, userStatusUpdate);
      await manager.update(KycStep, step.id, { status, result, comment: comment ?? null });
      await manager.save(
        manager.create(StepLog, {
          type: KycLogType.STEP,
          userData: { id: userData.id },
          kycStep: { id: step.id },
          status,
          result,
        }),
      );
      if (status === ReviewStatus.COMPLETED)
        await manager.save(
          manager.create(KycLog, {
            type: KycLogType.KYC,
            userData: { id: userData.id },
            result: `KycLevel changed to ${KycLevel.LEVEL_50} by DfxApproval manual workflow`,
          }),
        );

      Object.assign(userData, userStatusUpdate);
      return status === ReviewStatus.COMPLETED ? userData : undefined;
    });

    if (completedUser) await this.notificationService.kycChanged(completedUser, KycLevel.LEVEL_50);
  }

  private async processPersonalApproval(stepId: number): Promise<void> {
    let step = await this.loadStep(stepId);
    if (step.status !== ReviewStatus.MANUAL_REVIEW || step.userData.kycLevel !== KycLevel.LEVEL_40) return;

    const hasOpenNameChecks = await this.nameCheckService.hasOpenNameChecks(step.userData);
    await this.initializePersonalRiskData(step.userData, hasOpenNameChecks);

    step = await this.loadStep(stepId);
    const preflight = this.checkService.evaluatePersonal(
      step.userData,
      step,
      step.userData.kycFiles,
      hasOpenNameChecks,
    );
    if (preflight.blockers.some((blocker) => blocker.code !== DfxApprovalBlocker.MISSING_DOCUMENT)) return;

    await this.documentService.generateMissingPersonalDocuments(step.userData, step, step.userData.kycFiles);

    const completedUser = await this.completeIfReady(stepId);
    if (completedUser) await this.notificationService.kycChanged(completedUser, KycLevel.LEVEL_50);
  }

  private async initializePersonalRiskData(userData: UserData, hasOpenNameChecks: boolean): Promise<void> {
    if (!userData.hasValidNameCheckDate || hasOpenNameChecks) return;

    const update: Partial<UserData> = {};
    if (userData.pep == null) update.pep = false;
    if (userData.highRisk == null) update.highRisk = false;
    if (userData.complexOrgStructure == null) update.complexOrgStructure = false;
    if (userData.depositLimit == null) update.depositLimit = 100000;
    if (userData.amlAccountType == null) update.amlAccountType = 'natural person';
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
          depositLimit: String(userData.depositLimit),
          amlAccountType: userData.amlAccountType,
          processedBy: 'DFX API',
          finalDecision: 'Akzeptiert',
        },
      });

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
              kycLevel: KycLevel.LEVEL_50,
              kycStatus: KycStatus.COMPLETED,
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
      await manager.update(UserData, userData.id, {
        kycLevel: KycLevel.LEVEL_50,
        kycStatus: KycStatus.COMPLETED,
      });
      await manager.save(
        manager.create(KycLog, {
          type: KycLogType.KYC,
          userData: { id: userData.id },
          result: `KycLevel changed to ${KycLevel.LEVEL_50} by DfxApproval API workflow`,
        }),
      );

      Object.assign(userData, { kycLevel: KycLevel.LEVEL_50, kycStatus: KycStatus.COMPLETED });
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
          kycFiles: true,
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
        kycFiles: true,
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
