import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { MasternodeService } from 'src/payment/models/masternode/masternode.service';
import { StakingService } from 'src/payment/models/staking/staking.service';
import { WhaleService } from 'src/ain/whale/whale.service';
import { Util } from 'src/shared/util';
import { MonitoringStatus, BalanceStatus } from './dto/monitoring.dto';
import { UserDataService } from 'src/user/models/user-data/user-data.service';
import { BankTxService } from 'src/payment/models/bank-tx/bank-tx.service';
import { CryptoSellService } from 'src/payment/models/crypto-sell/crypto-sell.service';
import { BuyCryptoService } from 'src/payment/models/buy-crypto/buy-crypto.service';
import { StakingRefRewardService } from 'src/payment/models/staking-ref-reward/staking-ref-reward.service';
import { StakingRewardService } from 'src/payment/models/staking-reward/staking-reward.service';
import { NodeMode, NodeService, NodeType } from 'src/ain/node/node.service';

@Injectable()
export class MonitoringService {
  constructor(
    private nodeService: NodeService,
    private stakingService: StakingService,
    private masternodeService: MasternodeService,
    private whaleService: WhaleService,
    private userDataService: UserDataService,
    private bankTxService: BankTxService,
    private cryptoSellService: CryptoSellService,
    private buyCryptoService: BuyCryptoService,
    private stakingRefRewardService: StakingRefRewardService,
    private stakingRewardService: StakingRewardService,
  ) {}

  async getBalanceStatus(): Promise<BalanceStatus> {
    const whaleClient = this.whaleService.getClient();

    // calculate actual balance
    const activeMasternodes = await this.masternodeService.getActive();
    const addresses = [...activeMasternodes.map((m) => m.owner), Config.node.stakingWalletAddress];
    const balance = await Promise.all(addresses.map((a) => whaleClient.getBalance(a).then((b) => +b)));
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

  async getKycStatusData(): Promise<any> {
    return {
      current: await this.userDataService.getKycStatusData(),
      longer24h: await this.userDataService.getKycStatusData(Util.daysBefore(1, new Date())),
    };
  }

  async getBankTxWithoutType(): Promise<number> {
    return this.bankTxService.getBankTxWithoutType();
  }

  async getIncompleteTransactions(): Promise<any> {
    return {
      buyCrypto: await this.buyCryptoService.getIncompleteTransactions(),
      cryptoSell: await this.cryptoSellService.getIncompleteTransactions(),
      stakingRefRewards: await this.stakingRefRewardService.getIncompleteTransactions(),
    };
  }

  async getLastOutputDates(): Promise<any> {
    return {
      lastStakingReward: await this.stakingRewardService.getLastOutputDate(),
      lastCryptoSell: await this.cryptoSellService.getLastOutputDate(),
      lastBuyCrypto: await this.buyCryptoService.getLastOutputDate(),
    };
  }

  async getNodeBalances(): Promise<any> {
    return {
      defichain: {
        input: await this.nodeService.getClient(NodeType.INPUT, NodeMode.ACTIVE).getNodeBalance(),
        ref: await this.nodeService.getClient(NodeType.REF, NodeMode.ACTIVE).getNodeBalance(),
      },
    };
  }
}
