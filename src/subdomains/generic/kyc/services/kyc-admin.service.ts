import { Injectable, NotFoundException } from '@nestjs/common';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { BankDataType } from '../../user/models/bank-data/bank-data.entity';
import { BankDataService } from '../../user/models/bank-data/bank-data.service';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { UpdateKycStepDto } from '../dto/input/update-kyc-step.dto';
import { KycWebhookTriggerDto } from '../dto/kyc-webhook-trigger.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { KycLogType, KycStepStatus } from '../enums/kyc.enum';
import { KycLogRepository } from '../repositories/kyc-log.repository';
import { KycStepRepository } from '../repositories/kyc-step.repository';

@Injectable()
export class KycAdminService {
  constructor(
    private readonly kycLogRepo: KycLogRepository,
    private readonly kycStepRepo: KycStepRepository,
    private readonly webhookService: WebhookService,
    private readonly bankDataService: BankDataService,
  ) {}

  async getKycSteps(userDataId: number): Promise<KycStep[]> {
    return this.kycStepRepo.find({ where: { userData: { id: userDataId } }, relations: { userData: true } });
  }

  async updateLogPdfUrl(id: number, url: string): Promise<void> {
    const entity = await this.kycLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('KycLog not found');

    await this.kycLogRepo.update(...entity.setPdfUrl(url));
  }

  async updateKycStep(stepId: number, dto: UpdateKycStepDto): Promise<void> {
    const kycStep = await this.kycStepRepo.findOne({
      where: { id: stepId },
      relations: { userData: { bankDatas: true } },
    });
    if (!kycStep) throw new NotFoundException('KYC step not found');

    kycStep.update(dto.status, dto.result);

    if (kycStep.isValidCreatingBankData && !DisabledProcess(Process.AUTO_CREATE_BANK_DATA))
      await this.bankDataService.createBankData(kycStep.userData, {
        name: kycStep.completeName,
        iban: `Ident${kycStep.identDocumentId}`,
        type: BankDataType.IDENT,
      });

    await this.kycStepRepo.save(kycStep);
  }

  async triggerWebhook(dto: KycWebhookTriggerDto): Promise<void> {
    const kycStep = await this.kycStepRepo.findOne({
      where: [{ id: dto.kycStepId }, { userData: { id: dto.userDataId } }],
      relations: { userData: true },
      order: { updated: 'DESC' },
    });
    if (!kycStep) throw new NotFoundException('No kycSteps found');

    if (kycStep.status === KycStepStatus.FAILED) {
      await this.webhookService.kycFailed(kycStep.userData, dto.reason ?? 'KYC failed');
    } else {
      await this.webhookService.kycChanged(kycStep.userData);
    }
  }

  async createMergeLog(user: UserData, log: string): Promise<void> {
    const entity = this.kycLogRepo.create({
      type: KycLogType.MERGE,
      result: log,
      userData: user,
    });

    await this.kycLogRepo.save(entity);
  }
}
