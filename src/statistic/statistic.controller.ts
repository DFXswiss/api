import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CryptoBuyService } from 'src/payment/models/crypto-buy/crypto-buy.service';
import { CryptoSellService } from 'src/payment/models/crypto-sell/crypto-sell.service';
import { MasternodeService } from 'src/payment/models/masternode/masternode.service';
import { RefRewardService } from 'src/payment/models/ref-reward/ref-reward.service';
import { StakingRewardService } from 'src/payment/models/staking-reward/staking-reward.service';
import { CfpResult, CfpService } from 'src/statistic/cfp.service';
import { StatisticService } from './statistic.service';

@ApiTags('statistic')
@Controller('statistic')
export class StatisticController {
  constructor(
    private readonly statisticService: StatisticService,
    private readonly cfpService: CfpService,
    private readonly cryptoBuyService: CryptoBuyService,
    private readonly cryptoSellService: CryptoSellService,
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
      buy: await this.cryptoBuyService.getTransactions(dateFrom, dateTo),
      sell: await this.cryptoSellService.getTransactions(dateFrom, dateTo),
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
