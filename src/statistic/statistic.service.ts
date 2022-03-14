import { Injectable } from '@nestjs/common';
import { BuyService } from 'src/payment/models/buy/buy.service';
import { MasternodeService } from 'src/payment/models/masternode/masternode.service';
import { SellService } from 'src/payment/models/sell/sell.service';
import { StakingRewardService } from 'src/payment/models/staking-reward/staking-reward.service';
import { StakingService } from 'src/payment/models/staking/staking.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { UserService } from 'src/user/models/user/user.service';

@Injectable()
export class StatisticService {
  constructor(
    private buyService: BuyService,
    private sellService: SellService,
    private settingService: SettingService,
    private stakingRewardService: StakingRewardService,
    private stakingService: StakingService,
    private masternodeService: MasternodeService,
    private userService: UserService,
  ) {}

  async getStatus(): Promise<any> {
    const settings = await this.settingService.getAll();
    return settings
      .filter((s) => s.key.endsWith('Status'))
      .reduce((prev, curr) => ({ ...prev, [curr.key.replace('Status', '')]: curr.value }), {});
  }

  async getAll(): Promise<any> {
    return {
      totalVolume: {
        buy: await this.buyService.getTotalVolume(),
        sell: await this.sellService.getTotalVolume(),
      },
      totalRewards: {
        staking: await this.stakingService.getTotalStakingRewards(),
        ref: await this.userService.getTotalRefRewards(),
      },
      staking: {
        masternodes: await this.masternodeService.getCount(),
        yield: await this.stakingRewardService.getYield(),
      },
      status: await this.getStatus(),
    };
  }
}
