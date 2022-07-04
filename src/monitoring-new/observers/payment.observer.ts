import { Injectable, NotImplementedException } from '@nestjs/common';
import { MetricObserver } from 'src/monitoring-new/metric.observer';
import { MonitoringService } from 'src/monitoring-new/monitoring.service';
import { BankTxRepository } from 'src/payment/models/bank-tx/bank-tx.repository';
import { BuyCryptoRepository } from 'src/payment/models/buy-crypto/repositories/buy-crypto.repository';
import { CryptoSellRepository } from 'src/payment/models/crypto-sell/crypto-sell.repository';
import { DepositRepository } from 'src/payment/models/deposit/deposit.repository';
import { StakingRefRewardRepository } from 'src/payment/models/staking-ref-reward/staking-ref-reward.repository';
import { StakingRewardRepository } from 'src/payment/models/staking-reward/staking-reward.respository';
import { getCustomRepository, IsNull } from 'typeorm';

export interface PaymentData {
  lastOutputDates: LastOutputDates;
  incomplete: IncompleteTransactions;
  bankTxWithoutType: number;
  freeDeposit: number;
}

interface LastOutputDates {
  buyCrypto: Date;
  cryptoSell: Date;
  stakingReward: Date;
}

interface IncompleteTransactions {
  buyCrypto: number;
  cryptoSell: number;
  stakingRefRewards: number;
}

@Injectable()
export class PaymentObserver extends MetricObserver<PaymentData> {
  constructor(monitoringService: MonitoringService) {
    super(monitoringService, 'payment', 'combined');
  }

  async fetch() {
    const data = await this.getPayment();

    this.emit(data);

    return data;
  }

  onWebhook() {
    throw new NotImplementedException('Webhook is not supported by this metric. Ignoring incoming data');
  }

  async compare() {
    // no comparison required in this Observer
  }

  // *** HELPER METHODS *** //

  private async getPayment(): Promise<PaymentData> {
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

  private async getIncompleteTransactions(): Promise<IncompleteTransactions> {
    return {
      buyCrypto: await getCustomRepository(BuyCryptoRepository).count({ mailSendDate: IsNull() }),
      cryptoSell: await getCustomRepository(CryptoSellRepository).count({ mail3SendDate: IsNull() }),
      stakingRefRewards: await getCustomRepository(StakingRefRewardRepository).count({ mailSendDate: IsNull() }),
    };
  }

  private async getLastOutputDates(): Promise<LastOutputDates> {
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
}
