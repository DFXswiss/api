import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { BankDataType } from '../../user/models/bank-data/bank-data.entity';
import { BankDataService } from '../../user/models/bank-data/bank-data.service';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { IdentResultDto } from '../dto/input/ident-result.dto';
import { UpdateKycStepDto } from '../dto/input/update-kyc-step.dto';
import { KycWebhookTriggerDto } from '../dto/kyc-webhook-trigger.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName, KycStepStatus, KycStepType } from '../enums/kyc.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { KycService } from './kyc.service';

@Injectable()
export class KycAdminService {
  private readonly logger = new DfxLogger(KycAdminService);

  constructor(
    private readonly kycStepRepo: KycStepRepository,
    private readonly webhookService: WebhookService,
    @Inject(forwardRef(() => BankDataService)) private readonly bankDataService: BankDataService,
    private readonly kycService: KycService,
    private readonly countryService: CountryService,
  ) {}

  async getKycSteps(userDataId: number): Promise<KycStep[]> {
    return this.kycStepRepo.find({ where: { userData: { id: userDataId } }, relations: { userData: true } });
  }

  async updateKycStep(stepId: number, dto: UpdateKycStepDto): Promise<void> {
    const kycStep = await this.kycStepRepo.findOne({
      where: { id: stepId },
      relations: { userData: { bankDatas: true } },
    });
    if (!kycStep) throw new NotFoundException('KYC step not found');

    kycStep.update(dto.status, dto.result);

    if (kycStep.isCompleted) {
      if (kycStep.name === KycStepName.COMMERCIAL_REGISTER) {
        kycStep.userData = await this.kycService.completeCommercialRegister(kycStep.userData);
      }
      if (kycStep.name === KycStepName.IDENT) {
        const result = kycStep.getResult<IdentResultDto>();
        const nationality = result.userdata?.nationality?.value
          ? await this.countryService.getCountryWithSymbol(result.userdata.nationality.value)
          : null;

        kycStep.userData = await this.kycService.completeIdent(result, kycStep.userData, nationality);

        if (kycStep.isValidCreatingBankData && !DisabledProcess(Process.AUTO_CREATE_BANK_DATA))
          await this.bankDataService.createBankData(kycStep.userData, {
            name: kycStep.userName,
            iban: `Ident${kycStep.identDocumentId}`,
            type: BankDataType.IDENT,
          });
      }
    }

    await this.kycStepRepo.save(kycStep);
  }

  async resetKyc(userData: UserData): Promise<void> {
    for (const kycStep of userData.kycSteps) {
      if ([KycStepName.FINANCIAL_DATA, KycStepName.IDENT].includes(kycStep.name) && !kycStep.isFailed)
        await this.kycStepRepo.update(kycStep.id, { status: KycStepStatus.CANCELED });
    }
  }

  async triggerVideoIdentInternal(userData: UserData): Promise<void> {
    try {
      await this.kycService.getOrCreateStepInternal(userData.kycHash, KycStepName.IDENT, KycStepType.VIDEO);
    } catch (e) {
      this.logger.error(`Failed to trigger video ident internal for userData ${userData.id}:`, e);
    }
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
}
