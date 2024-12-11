import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
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

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  @Lock(1800)
  async createPendingRefRewards() {
    if (DisabledProcess(Process.REF_PAYOUT)) return;

    await this.refRewardService.createPendingRefRewards();
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock(1800)
  async processPendingRefRewards() {
    if (DisabledProcess(Process.REF_PAYOUT)) return;

    await this.refRewardDexService.secureLiquidity();
    await this.refRewardOutService.checkPaidTransaction();
    await this.refRewardOutService.payoutNewTransactions();
    await this.refRewardNotificationService.sendNotificationMails();
  }
}
