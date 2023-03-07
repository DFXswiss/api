import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BuyService } from '../buy-crypto/routes/buy/buy.service';
import { SettingStatus, StatisticDto } from './dto/statistic.dto';

@Injectable()
export class StatisticService implements OnModuleInit {
  private statistic: StatisticDto;

  constructor(
    private buyService: BuyService,
    private sellService: SellService,
    private settingService: SettingService,
    private userService: UserService,
  ) {}

  onModuleInit() {
    void this.doUpdate();
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
          staking: 1211040.03,
          ref: Util.round(await this.userService.getTotalRefRewards(), Config.defaultVolumeDecimal),
        },
        status: await this.getStatus(),
      };
    } catch (e) {
      console.error('Exception during statistic update:', e);
    }
  }

  async getStatus(): Promise<SettingStatus> {
    const settings = await this.settingService.getAll();
    return settings
      .filter((s) => s.key.endsWith('Status'))
      .reduce((prev, curr) => ({ ...prev, [curr.key.replace('Status', '')]: curr.value }), {});
  }

  getAll(): StatisticDto {
    return this.statistic;
  }
}
