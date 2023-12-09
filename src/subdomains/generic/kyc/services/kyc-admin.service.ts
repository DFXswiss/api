import { Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Not } from 'typeorm';
import { IdentAborted, IdentFailed, IdentPending, IdentSucceeded } from '../../user/models/ident/dto/ident-result.dto';
import { SpiderData } from '../../user/models/spider-data/spider-data.entity';
import { KycLevel, KycStatus, UserData } from '../../user/models/user-data/user-data.entity';
import { IdentResultDto } from '../dto/input/ident-result.dto';
import { UpdateKycStepDto } from '../dto/input/update-kyc-step.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName, KycStepStatus, KycStepType } from '../enums/kyc.enum';
import { KycLogRepository } from '../repositories/kyc-log.repository';
import { KycStepRepository } from '../repositories/kyc-step.repository';

@Injectable()
export class KycAdminService {
  private readonly logger = new DfxLogger(KycAdminService);

  constructor(
    private readonly kycLogRepo: KycLogRepository,
    private readonly kycStepRepo: KycStepRepository,
    private readonly repoFactory: RepositoryFactory,
  ) {}

  // TODO: remove temporary code
  @Cron(CronExpression.EVERY_HOUR)
  @Lock()
  async syncKycStatus() {
    const kycUsers = await this.repoFactory.userData.find({
      where: { kycStatus: Not(KycStatus.NA) },
      relations: { spiderData: true },
    });

    for (const user of kycUsers) {
      try {
        // update KYC level
        const kycLevel = user.kycLevel === KycLevel.LEVEL_0 ? this.getLevel(user.kycStatus) : user.kycLevel;
        if (kycLevel !== user.kycLevel) await this.repoFactory.userData.update(user.id, { kycLevel });

        // create completed steps
        const completedSteps = this.getCompletedSteps(user);
        const missingSteps = completedSteps.filter((n) => !user.kycSteps.some((s) => s.name === n));
        const stepsToUpdate = user.kycSteps.filter(
          (s) => !(s.isCompleted || s.isFailed) && completedSteps.some((cs) => cs === s.name),
        );

        // add missing steps
        const newSteps = [];
        for (const stepName of missingSteps) {
          const step: KycStep = Object.assign(new KycStep(), {
            userData: user,
            name: stepName,
            status: KycStepStatus.COMPLETED,
            sequenceNumber: 0,
          });

          this.setStepData(step, user);

          newSteps.push(step);
        }
        await this.kycStepRepo.save(newSteps);

        // update steps
        for (const step of stepsToUpdate) {
          this.setStepData(step, user);
          await this.kycStepRepo.save(step);
        }
      } catch (e) {
        this.logger.error(`Failed to sync KYC for user ${user.id}:`, e);
      }
    }
  }

  private getLevel(kycStatus: KycStatus): KycLevel {
    switch (kycStatus) {
      case KycStatus.NA:
        return KycLevel.LEVEL_0;

      case KycStatus.CHATBOT:
      case KycStatus.ONLINE_ID:
      case KycStatus.VIDEO_ID:
      case KycStatus.CHECK:
      case KycStatus.COMPLETED:
        return KycLevel.LEVEL_20;

      case KycStatus.REJECTED:
        return KycLevel.REJECTED;

      case KycStatus.TERMINATED:
        return KycLevel.TERMINATED;

      default:
        return KycLevel.LEVEL_0;
    }
  }

  private getCompletedSteps(user: UserData): KycStepName[] {
    if (user.kycStatus === KycStatus.NA) return [];

    const steps = [];

    if (user.mail) steps.push(KycStepName.CONTACT_DATA);
    if (user.isDataComplete) steps.push(KycStepName.PERSONAL_DATA);
    if (user.spiderData?.identResult) steps.push(KycStepName.IDENT);
    if (user.spiderData?.chatbotResult) steps.push(KycStepName.FINANCIAL_DATA);

    return steps;
  }

  private setStepData(step: KycStep, user: UserData) {
    switch (step.name) {
      case KycStepName.IDENT:
        step.status = this.getIdentStatus(user.spiderData);
        step.type = this.getIdentType(user.spiderData);
        step.sessionId = user.spiderData?.identIdentificationIds?.split(',').pop();
        step.result = user.spiderData?.identResult;
        break;

      case KycStepName.FINANCIAL_DATA:
        step.result = user.spiderData?.chatbotResult;
        break;
    }
  }

  private getIdentStatus(spiderData?: SpiderData): KycStepStatus {
    if (spiderData?.identResult) {
      const result: IdentResultDto = JSON.parse(spiderData.identResult);

      if (IdentPending(result)) {
        return KycStepStatus.CHECK_PENDING;
      } else if (IdentSucceeded(result)) {
        return KycStepStatus.COMPLETED;
      } else if (IdentAborted(result)) {
        return KycStepStatus.IN_PROGRESS;
      } else if (IdentFailed(result)) {
        return KycStepStatus.FAILED;
      }
    }

    return KycStepStatus.IN_PROGRESS;
  }

  private getIdentType(spiderData?: SpiderData): KycStepType {
    if (spiderData?.identResult?.includes('"dfxvideo"') || spiderData?.identResult?.includes('"kycspider"'))
      return KycStepType.VIDEO;

    if (spiderData?.identResult?.includes('"dfxauto"') || spiderData?.identResult?.includes('"kycspiderauto"'))
      return KycStepType.AUTO;

    return KycStepType.MANUAL;
  }

  async updateLogPdfUrl(id: number, url: string): Promise<void> {
    const entity = await this.kycLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('KycLog not found');

    await this.kycLogRepo.update(...entity.setPdfUrl(url));
  }

  async updateKycStep(stepId: number, dto: UpdateKycStepDto): Promise<void> {
    const kycStep = await this.kycStepRepo.findOneBy({ id: stepId });
    if (!kycStep) throw new NotFoundException('KYC step not found');

    kycStep.update(dto.status, dto.result);
    await this.kycStepRepo.save(kycStep);
  }
}
