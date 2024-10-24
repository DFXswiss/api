import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
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

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async process() {
    if (DisabledProcess(Process.BUY_CRYPTO)) return;
    await this.buyCryptoRegistrationService.registerCryptoPayIn();
    await this.buyCryptoRegistrationService.syncReturnTxId();
    if (!DisabledProcess(Process.AUTO_AML_CHECK)) await this.buyCryptoPreparationService.doAmlCheck();
    if (!DisabledProcess(Process.BUY_CRYPTO_REFRESH_FEE)) await this.buyCryptoPreparationService.refreshFee();
    await this.buyCryptoBatchService.batchAndOptimizeTransactions();
    await this.buyCryptoDexService.secureLiquidity();
    await this.buyCryptoOutService.payoutTransactions();
    await this.buyCryptoNotificationService.sendNotificationMails();
  }
}
