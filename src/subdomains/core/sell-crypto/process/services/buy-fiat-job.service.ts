import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { BuyFiatPreparationService } from './buy-fiat-preparation.service';
import { BuyFiatRegistrationService } from './buy-fiat-registration.service';

@Injectable()
export class BuyFiatJobService {
  constructor(
    private readonly buyFiatRegistrationService: BuyFiatRegistrationService,
    private readonly buyFiatPreparationService: BuyFiatPreparationService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.BUY_FIAT, timeout: 1800 })
  async checkCryptoPayIn() {
    await this.buyFiatRegistrationService.registerSellPayIn();
    await this.buyFiatRegistrationService.syncReturnTxId();
    if (!DisabledProcess(Process.AUTO_AML_CHECK)) await this.buyFiatPreparationService.doAmlCheck();
    if (!DisabledProcess(Process.BUY_FIAT_SET_FEE)) {
      await this.buyFiatPreparationService.refreshFee();
      await this.buyFiatPreparationService.fillPaymentLinkPayments();
    }
    await this.buyFiatPreparationService.setOutput();
    await this.buyFiatPreparationService.complete();
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.BUY_FIAT, timeout: 7200 })
  async addFiatOutputs(): Promise<void> {
    await this.buyFiatPreparationService.addFiatOutputs;
  }
}
