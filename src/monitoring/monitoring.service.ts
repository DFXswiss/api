import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { MasternodeService } from 'src/payment/models/masternode/masternode.service';
import { StakingService } from 'src/payment/models/staking/staking.service';
import { WhaleService } from 'src/shared/services/whale.service';

@Injectable()
export class MonitoringService {
  constructor(
    private stakingService: StakingService,
    private masternodeService: MasternodeService,
    private whaleService: WhaleService,
  ) {}
  // --- VOLUMES --- //
  async checkBalance(): Promise<any> {
    const whaleClient = this.whaleService.getClient();
    const activeMasternodes = await this.masternodeService.getActiveMasternodes();

    let actualBalance = 0;
    for (const masterNode of activeMasternodes) {
      actualBalance += +(await whaleClient.address.getBalance(masterNode.owner));
    }
    actualBalance += +(await whaleClient.address.getBalance(Config.node.stakingWalletAddress));
    const shouldBalance = await this.stakingService.getTotalStakingBalance();

    return { actualBalance, shouldBalance };
  }
}
