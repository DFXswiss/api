import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BuyService } from '../buy-crypto/routes/buy/buy.service';
import { SettingStatus, StatisticDto } from './dto/statistic.dto';

@Injectable()
export class StatisticService implements OnModuleInit {
  private statistic: StatisticDto;

  constructor(
    private readonly buyService: BuyService,
    private readonly sellService: SellService,
    private readonly settingService: SettingService,
    private readonly userService: UserService,
  ) {}

  onModuleInit() {
    void this.doUpdate();
  }

  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.UPDATE_STATISTIC, timeout: 7200 })
  async doUpdate(): Promise<void> {
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
