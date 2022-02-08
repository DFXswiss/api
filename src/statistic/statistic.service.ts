import { Injectable } from '@nestjs/common';
import { BuyService } from 'src/payment/models/buy/buy.service';
import { SellService } from 'src/payment/models/sell/sell.service';
import { SettingService } from 'src/shared/setting/setting.service';

@Injectable()
export class StatisticService {
  constructor(
    private buyService: BuyService,
    private sellService: SellService,
    private settingService: SettingService, //private stakingService: StakingService,
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
      status: await this.getStatus(),
      //TODO staking: await this.stakingService.getStakingYield(),
    };
  }
}
