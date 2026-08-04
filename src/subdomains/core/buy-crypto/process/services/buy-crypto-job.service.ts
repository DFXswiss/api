import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { CustomCronExpression } from 'src/shared/utils/custom-cron-expression';
import { BuyCryptoBatchService } from './buy-crypto-batch.service';
import { BuyCryptoDexService } from './buy-crypto-dex.service';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { BuyCryptoOutService } from './buy-crypto-out.service';
import { BuyCryptoPreparationService } from './buy-crypto-preparation.service';
import { BuyCryptoRegistrationService } from './buy-crypto-registration.service';

@Injectable()
export class BuyCryptoJobService {
  constructor(
    private readonly buyCryptoBatchService: BuyCryptoBatchService,
    private readonly buyCryptoOutService: BuyCryptoOutService,
    private readonly buyCryptoDexService: BuyCryptoDexService,
    private readonly buyCryptoRegistrationService: BuyCryptoRegistrationService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly buyCryptoPreparationService: BuyCryptoPreparationService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.WORKER, process: Process.BUY_CRYPTO, timeout: 7200 })
  async process() {
    await this.buyCryptoRegistrationService.registerCryptoPayIn();
    await this.buyCryptoRegistrationService.syncReturnTxId();
    if (!DisabledProcess(Process.AUTO_AML_CHECK)) await this.buyCryptoPreparationService.doAmlCheck();
    if (!DisabledProcess(Process.BUY_CRYPTO_REFRESH_FEE)) {
      await this.buyCryptoPreparationService.refreshFee();
      await this.buyCryptoPreparationService.fillPaymentLinkPayments();
    }
    await this.buyCryptoBatchService.batchAndOptimizeTransactions();
    await this.buyCryptoDexService.secureLiquidity();
    await this.buyCryptoOutService.payoutTransactions();
    await this.buyCryptoPreparationService.chargebackTx();
    await this.buyCryptoPreparationService.chargebackFillUp();
    await this.buyCryptoNotificationService.sendNotificationMails();
  }

  // Own, coarser cadence: matching latency is dominated by the matcher's 60-minute maturity delay
  // anyway, and each candidate costs a ~50ms query (three fiat_output anti-join scans) - running
  // it every minute would buy nothing but DB load.
  @DfxCron(CustomCronExpression.EVERY_15_MINUTES, {
    scope: CronScope.WORKER,
    process: Process.EXTERNAL_CHARGEBACK_MATCH,
    timeout: 1800,
  })
  async matchExternalChargebacks() {
    await this.buyCryptoPreparationService.matchExternalChargebacks();
  }

  @DfxCron(CronExpression.EVERY_HOUR, {
    scope: CronScope.WORKER,
    process: Process.BUY_CRYPTO_AGGREGATION,
    timeout: 7200,
  })
  async checkAggregatingTransactions() {
    await this.buyCryptoPreparationService.checkAggregatingTransactions();
  }
}
