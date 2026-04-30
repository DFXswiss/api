import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { RefRewardDexService } from './ref-reward-dex.service';
import { RefRewardNotificationService } from './ref-reward-notification.service';
import { RefRewardOutService } from './ref-reward-out.service';
import { RefRewardService } from './ref-reward.service';

@Injectable()
export class RefRewardJobService {
  constructor(
    private readonly refRewardNotificationService: RefRewardNotificationService,
    private readonly refRewardDexService: RefRewardDexService,
    private readonly refRewardOutService: RefRewardOutService,
    private readonly refRewardService: RefRewardService,
  ) {}

  @DfxCron(CronExpression.EVERY_DAY_AT_6AM, { process: Process.REF_PAYOUT, timeout: 1800 })
  async createPendingRefRewards() {
    await this.refRewardService.createPendingRefRewards();
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.REF_PAYOUT, timeout: 1800 })
  async processPendingRefRewards() {
    await this.refRewardDexService.secureLiquidity();
    await this.refRewardOutService.checkPaidTransaction();
    await this.refRewardOutService.payoutNewTransactions();
    await this.refRewardNotificationService.sendNotificationMails();
  }
}
