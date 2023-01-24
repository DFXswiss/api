import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/buy-fiat.service';
import { MasternodeService } from 'src/subdomains/supporting/masternode/masternode.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/ref-reward.service';
import { StakingRewardService } from 'src/subdomains/core/staking/services/staking-reward.service';
import { CfpResult, CfpService } from 'src/subdomains/core/statistic/cfp.service';
import { StatisticService } from './statistic.service';
import { BuyCryptoService } from '../buy-crypto/process/services/buy-crypto.service';

@ApiTags('statistic')
@Controller('statistic')
export class StatisticController {
  constructor(
    private readonly statisticService: StatisticService,
    private readonly cfpService: CfpService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly stakingRewardService: StakingRewardService,
    private readonly refRewardService: RefRewardService,
    private readonly masternodeService: MasternodeService,
  ) {}

  @Get()
  async getAll(): Promise<any> {
    return this.statisticService.getAll();
  }

  @Get('status')
  async getStatus(): Promise<any> {
    return this.statisticService.getStatus();
  }

  @Get('transactions')
  async getTransactions(@Query('dateFrom') dateFrom: Date, @Query('dateTo') dateTo: Date): Promise<any> {
    return {
      buy: await this.buyCryptoService.getTransactions(dateFrom, dateTo),
      sell: await this.buyFiatService.getTransactions(dateFrom, dateTo),
      stakingRewards: await this.stakingRewardService.getTransactions(dateFrom, dateTo),
      refRewards: await this.refRewardService.getTransactions(dateFrom, dateTo),
    };
  }

  @Get('masternodes')
  async getMasternodes(): Promise<string[]> {
    const masternodes = await this.masternodeService.getActive();
    return masternodes.map((a) => a.owner);
  }

  @Get('cfp')
  async getCfpList(): Promise<string[]> {
    return this.cfpService.getCfpList();
  }

  @Get('cfp/:id')
  async getCfpResults(@Param('id') cfpId: string): Promise<CfpResult[]> {
    return this.cfpService.getCfpResults(cfpId);
  }
}
