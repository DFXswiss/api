import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler/dist/throttler.decorator';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { Util } from 'src/shared/utils/util';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { BuyCryptoService } from '../buy-crypto/process/services/buy-crypto.service';
import { SettingStatus, StatisticDto, TransactionStatisticDto } from './dto/statistic.dto';
import { StatisticService } from './statistic.service';

@ApiTags('Statistic')
@Controller('statistic')
@ApiExcludeController()
export class StatisticController {
  constructor(
    private readonly statisticService: StatisticService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly refRewardService: RefRewardService,
  ) {}

  @Get()
  @ApiOkResponse({ type: StatisticDto })
  async getAll(): Promise<StatisticDto> {
    return this.statisticService.getAll();
  }

  @Get('status')
  @ApiOkResponse({ type: SettingStatus })
  async getStatus(): Promise<SettingStatus> {
    return this.statisticService.getStatus();
  }

  @Get('transactions')
  @UseGuards(RateLimitGuard)
  @Throttle(24, 86400)
  @ApiOkResponse({ type: TransactionStatisticDto })
  async getTransactions(
    @Query('dateFrom') dateFrom: Date,
    @Query('dateTo') dateTo: Date,
  ): Promise<TransactionStatisticDto> {
    dateTo ??= new Date();
    dateFrom ??= Util.daysBefore(7, dateTo);

    return {
      buy: await this.buyCryptoService.getTransactions(dateFrom, dateTo),
      sell: await this.buyFiatService.getTransactions(dateFrom, dateTo),
      refRewards: await this.refRewardService.getTransactions(dateFrom, dateTo),
    };
  }
}
