import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { WhaleService } from 'src/integration/blockchain/ain/whale/whale.service';
import { Config } from 'src/config/config';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { CryptoInput } from 'src/mix/models/crypto-input/crypto-input.entity';
import { CryptoStakingRepository } from 'src/mix/models/crypto-staking/crypto-staking.repository';
import { MasternodeRepository } from 'src/mix/models/masternode/masternode.repository';
import { PayoutType } from 'src/mix/models/staking-reward/staking-reward.entity';
import { Util } from 'src/shared/utils/util';
import { getCustomRepository, IsNull, Not } from 'typeorm';
import { DepositRoute } from 'src/mix/models/route/deposit-route.entity';

interface StakingData {
  stakingBalance: { actual: number; should: number; difference: number };
  freeOperator: number;
  unmatchedStaking: number;
}

@Injectable()
export class StakingBalanceObserver extends MetricObserver<StakingData> {
  constructor(monitoringService: MonitoringService, private whaleService: WhaleService) {
    super(monitoringService, 'staking', 'balance');
  }

  @Interval(900000)
  async fetch(): Promise<StakingData> {
    try {
      const data = await this.getStaking();

      this.emit(data);

      return data;
    } catch (e) {
      console.error('Exception during monitoring staking balance:', e);
    }
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
    const addresses = [...activeMasternodes.map((m) => m.owner), Config.blockchain.default.stakingWalletAddress];
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
