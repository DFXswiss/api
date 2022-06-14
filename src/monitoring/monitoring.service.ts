import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { MasternodeService } from 'src/payment/models/masternode/masternode.service';
import { StakingService } from 'src/payment/models/staking/staking.service';
import { WhaleService } from 'src/ain/whale/whale.service';
import { Util } from 'src/shared/util';
import { UserDataService } from 'src/user/models/user-data/user-data.service';
import { BankTxService } from 'src/payment/models/bank-tx/bank-tx.service';
import { CryptoSellService } from 'src/payment/models/crypto-sell/crypto-sell.service';
import { BuyCryptoService } from 'src/payment/models/buy-crypto/buy-crypto.service';
import { StakingRefRewardService } from 'src/payment/models/staking-ref-reward/staking-ref-reward.service';
import { StakingRewardService } from 'src/payment/models/staking-reward/staking-reward.service';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { NodeClient } from 'src/ain/node/node-client';
import { UserService } from 'src/user/models/user/user.service';
import { CryptoStakingService } from 'src/payment/models/crypto-staking/crypto-staking.service';

@Injectable()
export class MonitoringService {
  private inpClient: NodeClient;
  private refClient: NodeClient;

  constructor(
    nodeService: NodeService,
    private stakingService: StakingService,
    private masternodeService: MasternodeService,
    private whaleService: WhaleService,
    private userDataService: UserDataService,
    private userService: UserService,
    private bankTxService: BankTxService,
    private cryptoSellService: CryptoSellService,
    private buyCryptoService: BuyCryptoService,
    private stakingRefRewardService: StakingRefRewardService,
    private stakingRewardService: StakingRewardService,
    private cryptoStakingService: CryptoStakingService,
  ) {
    nodeService.getConnectedNode(NodeType.INPUT).subscribe((client) => (this.inpClient = client));
    nodeService.getConnectedNode(NodeType.REF).subscribe((client) => (this.refClient = client));
  }

  async getStakingBalance(): Promise<{ actual: number; should: number; difference: number }> {
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
    return { actual, should, difference };
  }

  async getKycStatusData(): Promise<any> {
    return {
      current: await this.userDataService.getKycStatusData(),
      longer24h: await this.userDataService.getKycStatusData(Util.daysBefore(1, new Date())),
    };
  }

  async getBankTxWithoutType(): Promise<number> {
    return await this.bankTxService.getBankTxWithoutType();
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
      buyCrypto: await this.buyCryptoService.getLastOutputDate(),
      cryptoSell: await this.cryptoSellService.getLastOutputDate(),
      stakingReward: await this.stakingRewardService.getLastOutputDate(),
    };
  }

  async getNodeBalances(): Promise<any> {
    return {
      defichain: {
        input: await this.inpClient.getNodeBalance(),
        ref: await this.refClient.getNodeBalance(),
      },
    };
  }

  async getUserWithoutIpCountry(): Promise<number> {
    return await this.userService.getUserWithoutIpCountry();
  }

  async getWrongCryptoStaking(): Promise<number> {
    return await this.cryptoStakingService.getWrongCryptoStaking();
  }

  async getFreeOperators(): Promise<number> {
    return await this.masternodeService.getFreeOperators();
  }
}
