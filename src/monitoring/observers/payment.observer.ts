import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { BankTxRepository } from 'src/payment/models/bank-tx/bank-tx.repository';
import { AmlCheck } from 'src/payment/models/buy-crypto/enums/aml-check.enum';
import { BuyCryptoRepository } from 'src/payment/models/buy-crypto/repositories/buy-crypto.repository';
import { CryptoInputType } from 'src/payment/models/crypto-input/crypto-input.entity';
import { CryptoInputRepository } from 'src/payment/models/crypto-input/crypto-input.repository';
import { CryptoSellRepository } from 'src/payment/models/crypto-sell/crypto-sell.repository';
import { DepositRepository } from 'src/payment/models/deposit/deposit.repository';
import { StakingRefRewardRepository } from 'src/payment/models/staking-ref-reward/staking-ref-reward.repository';
import { StakingRewardRepository } from 'src/payment/models/staking-reward/staking-reward.respository';
import { getCustomRepository, IsNull, Not } from 'typeorm';

interface PaymentData {
  lastOutputDates: LastOutputDates;
  incomplete: IncompleteTransactions;
  bankTxWithoutType: number;
  freeDeposit: number;
  unhandledCryptoInputs: number;
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

  @Interval(900000)
  async fetch() {
    const data = await this.getPayment();

    this.emit(data);

    return data;
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
      unhandledCryptoInputs: await getCustomRepository(CryptoInputRepository).count({
        where: {
          type: Not(CryptoInputType.CRYPTO_CRYPTO),
          buyFiat: { id: IsNull() },
          cryptoStaking: { id: IsNull() },
          /* TODO: Buy_Crypto */
        },
        relations: ['buyFiat', 'cryptoStaking'],
      }),
    };
  }

  private async getIncompleteTransactions(): Promise<IncompleteTransactions> {
    return {
      buyCrypto: await getCustomRepository(BuyCryptoRepository).count({
        mailSendDate: IsNull(),
        amlCheck: Not(AmlCheck.FAIL),
      }),
      cryptoSell: await getCustomRepository(CryptoSellRepository).count({
        mail3SendDate: IsNull(),
        amlCheck: Not(AmlCheck.FAIL),
      }),
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
