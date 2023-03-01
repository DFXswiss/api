import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/buy-fiat.service';
import { MasternodeService } from 'src/subdomains/supporting/masternode/masternode.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/ref-reward.service';
import { CfpService } from 'src/subdomains/core/statistic/cfp.service';
import { StatisticService } from './statistic.service';
import { BuyCryptoService } from '../buy-crypto/process/services/buy-crypto.service';
import { CfpResult } from './dto/cfp.dto';
import { SettingStatus, StatisticDto, TransactionStatisticDto } from './dto/statistic.dto';

@ApiTags('Statistic')
@Controller('statistic')
export class StatisticController {
  constructor(
    private readonly statisticService: StatisticService,
    private readonly cfpService: CfpService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly refRewardService: RefRewardService,
    private readonly masternodeService: MasternodeService,
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
  @ApiOkResponse({ type: TransactionStatisticDto })
  async getTransactions(
    @Query('dateFrom') dateFrom: Date,
    @Query('dateTo') dateTo: Date,
  ): Promise<TransactionStatisticDto> {
    return {
      buy: await this.buyCryptoService.getTransactions(dateFrom, dateTo),
      sell: await this.buyFiatService.getTransactions(dateFrom, dateTo),
      refRewards: await this.refRewardService.getTransactions(dateFrom, dateTo),
    };
  }

  @Get('masternodes')
  @ApiOkResponse({ type: String, isArray: true })
  async getMasternodes(): Promise<string[]> {
    const masternodes = await this.masternodeService.getActive();
    return masternodes.map((a) => a.owner);
  }

  @Get('cfp/latest')
  @ApiOkResponse({ type: CfpResult, isArray: true })
  async getCfpResults(): Promise<CfpResult[]> {
    return this.cfpService.getCfpResults();
  }
}
