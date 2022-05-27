import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { MasternodeService } from 'src/payment/models/masternode/masternode.service';
import { StakingService } from 'src/payment/models/staking/staking.service';
import { WhaleService } from 'src/ain/whale/whale.service';
import { Util } from 'src/shared/util';
import { MonitoringStatus, BalanceStatus } from './dto/monitoring.dto';

@Injectable()
export class MonitoringService {
  constructor(
    private stakingService: StakingService,
    private masternodeService: MasternodeService,
    private whaleService: WhaleService,
  ) {}

  async getBalanceStatus(): Promise<BalanceStatus> {
    const client = this.whaleService.getClient();

    // calculate actual balance
    const activeMasternodes = await this.masternodeService.getActive();
    const addresses = [...activeMasternodes.map((m) => m.owner), Config.node.stakingWalletAddress];
    const balance = await Promise.all(addresses.map((a) => client.getBalance(a).then((b) => +b)));
    const actual = Util.sum(balance);

    // calculate should balance
    const stakingBalance = await this.stakingService.getTotalStakingBalance();
    const masternodeCount = await this.masternodeService.getCount();
    const should = stakingBalance + 20000 - masternodeCount * 10;

    // calculate difference
    const difference = Util.round(actual - should, 2);

    // set balance status
    const status = Math.abs(difference) < 1 ? MonitoringStatus.OK : MonitoringStatus.WARNING;
    return { actual, should, difference, status };
  }

  async getData(): Promise<any> {
    return {};
  }
}
