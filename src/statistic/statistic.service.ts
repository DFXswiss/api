import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { BuyService } from 'src/payment/models/buy/buy.service';
import { MasternodeService } from 'src/payment/models/masternode/masternode.service';
import { SellService } from 'src/payment/models/sell/sell.service';
import { StakingRewardService } from 'src/payment/models/staking-reward/staking-reward.service';
import { StakingService } from 'src/payment/models/staking/staking.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Util } from 'src/shared/util';
import { UserService } from 'src/user/models/user/user.service';

@Injectable()
export class StatisticService {
  private statistic: any;

  constructor(
    private buyService: BuyService,
    private sellService: SellService,
    private settingService: SettingService,
    private stakingRewardService: StakingRewardService,
    private stakingService: StakingService,
    private masternodeService: MasternodeService,
    private userService: UserService,
  ) {
    this.doUpdate().then();
  }

  @Interval(3600000)
  async doUpdate(): Promise<void> {
    try {
      this.statistic = {
        totalVolume: {
          buy: Util.round(await this.buyService.getTotalVolume(), Config.defaultVolumeDecimal),
          sell: Util.round(await this.sellService.getTotalVolume(), Config.defaultVolumeDecimal),
        },
        totalRewards: {
          staking: Util.round(await this.stakingService.getTotalStakingRewards(), Config.defaultVolumeDecimal),
          ref: Util.round(await this.userService.getTotalRefRewards(), Config.defaultVolumeDecimal),
        },
        staking: {
          masternodes: await this.masternodeService.getActiveCount(),
          yield: await this.stakingRewardService.getYield(),
        },
        status: await this.getStatus(),
      };
    } catch (e) {
      console.error('Exception during statistic update:', e);
    }
  }

  async getStatus(): Promise<any> {
    const settings = await this.settingService.getAll();
    return settings
      .filter((s) => s.key.endsWith('Status'))
      .reduce((prev, curr) => ({ ...prev, [curr.key.replace('Status', '')]: curr.value }), {});
  }

  async getAll(): Promise<any> {
    return this.statistic;
  }
}
