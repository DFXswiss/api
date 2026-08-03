import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config, CronRole } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BuyService } from '../buy-crypto/routes/buy/buy.service';
import { SettingStatus, StatisticDto } from './dto/statistic.dto';

@Injectable()
export class StatisticService implements OnModuleInit {
  private readonly logger = new DfxLogger(StatisticService);

  private statistic: StatisticDto;

  constructor(
    private readonly buyService: BuyService,
    private readonly sellService: SellService,
    private readonly settingService: SettingService,
    private readonly userService: UserService,
  ) {}

  onModuleInit() {
    // Fills the statistic once at start-up instead of leaving getAll answering with undefined
    // until the first scheduled run an hour later. The three conditions below are the ones the
    // scheduler applies to the job itself, and this call bypasses the scheduler entirely.
    //
    // The role first: the job is scoped `api` because a request path is the only reader of the
    // field it writes. Run here unconditionally, both processes execute it once at boot — outside
    // the cross-process lease, so nothing notices — and the worker spends the aggregation queries
    // on a value no request in that process can read.
    if (Config.cronRole === CronRole.WORKER) return;

    // Then the flag: a job switched off through DISABLED_PROCESSES has to stay off, including at
    // start-up. Otherwise switching it off still leaves one run per deployment.
    if (DisabledProcess(Process.UPDATE_STATISTIC)) return;

    void this.doUpdate().catch((e) =>
      // Not rethrown: an unhandled rejection here takes the process down over a statistic, and the
      // scheduled run retries within the hour. Logged rather than swallowed, so the empty response
      // in the meantime has a reason on record.
      this.logger.error('Failed to fill the statistic at start-up:', e),
    );
  }

  @DfxCron(CronExpression.EVERY_HOUR, { scope: CronScope.API, process: Process.UPDATE_STATISTIC, timeout: 7200 })
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
    const settings = await this.settingService.getStatusSettings();
    return settings.reduce((prev, curr) => ({ ...prev, [curr.key.replace('Status', '')]: curr.value }), {});
  }

  getAll(): StatisticDto {
    return this.statistic;
  }
}
