import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { WhaleService } from 'src/ain/whale/whale.service';
import { Util } from 'src/shared/util';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { NodeClient } from 'src/ain/node/node-client';
import { SpiderDataRepository } from 'src/user/models/spider-data/spider-data.repository';
import { In, IsNull, LessThan, Not } from 'typeorm';
import { IdentCompletedStates, KycStatus } from 'src/user/models/user-data/user-data.entity';
import { getCustomRepository } from 'typeorm';
import { BankTxRepository } from 'src/payment/models/bank-tx/bank-tx.repository';
import { BuyCryptoRepository } from 'src/payment/models/buy-crypto/repositories/buy-crypto.repository';
import { CryptoSellRepository } from 'src/payment/models/crypto-sell/crypto-sell.repository';
import { StakingRefRewardRepository } from 'src/payment/models/staking-ref-reward/staking-ref-reward.repository';
import { StakingRewardRepository } from 'src/payment/models/staking-reward/staking-reward.respository';
import { DepositRepository } from 'src/payment/models/deposit/deposit.repository';
import { UserDataRepository } from 'src/user/models/user-data/user-data.repository';
import { User, UserStatus } from 'src/user/models/user/user.entity';
import { UserRepository } from 'src/user/models/user/user.repository';
import { MasternodeRepository } from 'src/payment/models/masternode/masternode.repository';
import { CryptoStakingRepository } from 'src/payment/models/crypto-staking/crypto-staking.repository';
import { DepositRoute } from 'src/payment/models/route/deposit-route.entity';
import { CryptoInput } from 'src/payment/models/crypto-input/crypto-input.entity';
import { PayoutType } from 'src/payment/models/staking-reward/staking-reward.entity';

@Injectable()
export class MonitoringService {
  private inpClient: NodeClient;
  private refClient: NodeClient;
  private btcInpClient: NodeClient;

  constructor(nodeService: NodeService, private whaleService: WhaleService) {
    nodeService.getConnectedNode(NodeType.INPUT).subscribe((client) => (this.inpClient = client));
    nodeService.getConnectedNode(NodeType.REF).subscribe((client) => (this.refClient = client));
    nodeService.getConnectedNode(NodeType.BTC_INPUT).subscribe((client) => (this.btcInpClient = client));
  }

  // Payment

  async getPayment(): Promise<any> {
    return {
      lastOutputDates: await this.getLastOutputDates(),
      incomplete: await this.getIncompleteTransactions(),
      bankTxWithoutType: await getCustomRepository(BankTxRepository).count({ type: IsNull() }),
      freeDeposit: await getCustomRepository(DepositRepository)
        .createQueryBuilder('deposit')
        .leftJoin('deposit.route', 'route')
        .where('route.id IS NULL')
        .getCount(),
    };
  }

  async getIncompleteTransactions(): Promise<any> {
    return {
      buyCrypto: await getCustomRepository(BuyCryptoRepository).count({ mailSendDate: IsNull() }),
      cryptoSell: await getCustomRepository(CryptoSellRepository).count({ mail3SendDate: IsNull() }),
      stakingRefRewards: await getCustomRepository(StakingRefRewardRepository).count({ mailSendDate: IsNull() }),
    };
  }

  async getLastOutputDates(): Promise<any> {
    return {
      buyCrypto: await getCustomRepository(BuyCryptoRepository)
        .findOne({ order: { outputDate: 'DESC' } })
        .then((b) => b.outputDate),
      cryptoSell: await getCustomRepository(CryptoSellRepository)
        .findOne({ order: { outputDate: 'DESC' } })
        .then((b) => b.outputDate),
      stakingReward: await getCustomRepository(StakingRewardRepository)
        .findOne({ order: { outputDate: 'DESC' } })
        .then((b) => b.outputDate),
    };
  }

  // Node

  async getNode(): Promise<any> {
    return {
      balance: {
        defichain: {
          input: await this.inpClient.getNodeBalance(),
          ref: await this.refClient.getNodeBalance(),
        },
        bitcoin: {
          input: await this.btcInpClient.getBalance(),
        },
      },
    };
  }

  // User

  async getUser(): Promise<any> {
    return {
      kycStatus: {
        all: await this.getKycStatusData(),
        longer24h: await this.getKycStatusData(Util.daysBefore(1)),
      },
      userWithout: await this.getUserWithout(),
    };
  }

  async getKycStatusData(date: Date = new Date()): Promise<any> {
    const kycStatusData = {};
    for (const kycStatus of Object.values(KycStatus)) {
      kycStatusData[kycStatus] = await getCustomRepository(UserDataRepository).count({
        where: [
          {
            kycStatus,
            kycStatusChangeDate: LessThan(date),
          },
          {
            kycStatus,
            kycStatusChangeDate: IsNull(),
          },
        ],
      });
    }

    return kycStatusData;
  }

  async getUserWithout(): Promise<any> {
    return {
      ipCountry: await getCustomRepository(UserRepository).count({ where: { ipCountry: IsNull() } }),
      riskState: await getCustomRepository(UserDataRepository)
        .createQueryBuilder('userData')
        .leftJoin(User, 'user', 'userData.id = user.userDataId')
        .where('user.status != :status', { status: UserStatus.NA })
        .andWhere('userData.riskState is NULL')
        .getCount(),
      pdfUrl: await getCustomRepository(SpiderDataRepository).count({
        where: { identPdf: IsNull(), userData: { kycStatus: In(IdentCompletedStates) } },
        relations: ['userData'],
      }),
    };
  }

  // Staking

  async getStaking(): Promise<any> {
    return {
      stakingBalance: await this.getStakingBalance(),
      freeOperator: await getCustomRepository(MasternodeRepository).count({ where: { creationHash: IsNull() } }),
      unmatchedStaking: await getCustomRepository(CryptoStakingRepository)
        .createQueryBuilder('cryptoStaking')
        .leftJoin(DepositRoute, 'depositRoute', 'cryptoStaking.paybackDepositId = depositRoute.depositId')
        .leftJoin(
          CryptoInput,
          'cryptoInput',
          '(cryptoStaking.outTxId = cryptoInput.inTxId OR cryptoStaking.outTxId2 = cryptoInput.inTxId) AND cryptoInput.routeId = depositRoute.id',
        )
        .leftJoin(DepositRoute, 'depositRoute2', 'cryptoInput.routeId = depositRoute2.id')
        .where('cryptoStaking.payoutType != :payoutType', { payoutType: PayoutType.WALLET })
        .andWhere('cryptoStaking.outTxId IS NOT NULL')
        .andWhere('cryptoStaking.outputDate > :date', { date: Util.daysBefore(7, new Date()) })
        .andWhere('(cryptoInput.id IS NULL OR depositRoute.userId != depositRoute2.userId)')
        .getCount(),
    };
  }

  async getStakingBalance(): Promise<{ actual: number; should: number; difference: number }> {
    const whaleClient = this.whaleService.getClient();

    // calculate actual balance
    const activeMasternodes = await getCustomRepository(MasternodeRepository).find({
      where: {
        creationHash: Not(IsNull()),
        resignHash: IsNull(),
      },
    });
    const addresses = [...activeMasternodes.map((m) => m.owner), Config.node.stakingWalletAddress];
    const balance = await Promise.all(addresses.map((a) => whaleClient.getBalance(a).then((b) => +b)));
    const actual = Util.sum(balance);

    // calculate should balance
    const should = await getCustomRepository(CryptoStakingRepository)
      .createQueryBuilder('cryptoStaking')
      .where('readyToPayout = 0')
      .select('SUM(inputAmount)', 'balance')
      .getRawOne<{ balance: number }>()
      .then((b) => b.balance);

    // calculate difference
    const difference = Util.round(actual - should, Config.defaultVolumeDecimal);
    return { actual, should, difference };
  }
}
