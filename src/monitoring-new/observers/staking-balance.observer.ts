import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { WhaleService } from 'src/ain/whale/whale.service';
import { Config } from 'src/config/config';
import { MetricObserver } from 'src/monitoring-new/metric.observer';
import { MonitoringService } from 'src/monitoring-new/monitoring.service';
import { CryptoInput } from 'src/payment/models/crypto-input/crypto-input.entity';
import { CryptoStakingRepository } from 'src/payment/models/crypto-staking/crypto-staking.repository';
import { MasternodeRepository } from 'src/payment/models/masternode/masternode.repository';
import { DepositRoute } from 'src/payment/models/route/deposit-route.entity';
import { PayoutType } from 'src/payment/models/staking-reward/staking-reward.entity';
import { Util } from 'src/shared/util';
import { getCustomRepository, IsNull, Not } from 'typeorm';

export interface StakingData {
  stakingBalance: { actual: number; should: number; difference: number };
  freeOperator: number;
  unmatchedStaking: number;
}

@Injectable()
export class StakingBalanceObserver extends MetricObserver<StakingData> {
  constructor(monitoringService: MonitoringService, private whaleService: WhaleService) {
    super(monitoringService, 'staking', 'stakingBalance');
  }

  @Interval(60000)
  async fetch() {
    let data: StakingData;

    try {
      data = await this.getStaking();
    } catch (e) {
      data = this.getDefaultData();
    }

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getStaking(): Promise<StakingData> {
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

  private async getStakingBalance(): Promise<{ actual: number; should: number; difference: number }> {
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

  private getDefaultData(): StakingData {
    return {
      stakingBalance: { actual: 0, should: 0, difference: 0 },
      freeOperator: 0,
      unmatchedStaking: 0,
    };
  }
}
