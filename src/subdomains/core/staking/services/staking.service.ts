import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StakingReturnService } from './staking-return.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Lock } from 'src/shared/utils/lock';

@Injectable()
export class StakingService {
  private readonly returnLock = new Lock(1800);

  constructor(
    private readonly stakingReturnService: StakingReturnService,
    private readonly settingService: SettingService,
  ) {}

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  async checkCryptoPayIn() {
    if ((await this.settingService.get('staking-return')) !== 'on') return;
    if (!this.returnLock.acquire()) return;

    try {
      await this.stakingReturnService.returnStakingPayIn();
    } catch (e) {
      console.error('Error during staking-return pay-in registration', e);
    } finally {
      this.returnLock.release();
    }
  }
}
