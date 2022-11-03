import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { BankTxRepository } from 'src/payment/models/bank-tx/bank-tx.repository';
import { AmlCheck } from 'src/payment/models/buy-crypto/enums/aml-check.enum';
import { BuyCryptoRepository } from 'src/payment/models/buy-crypto/repositories/buy-crypto.repository';
import { BuyFiatRepository } from 'src/payment/models/buy-fiat/buy-fiat.repository';
import { CryptoInputType } from 'src/payment/models/crypto-input/crypto-input.entity';
import { CryptoInputRepository } from 'src/payment/models/crypto-input/crypto-input.repository';
import { DepositRepository } from 'src/payment/models/deposit/deposit.repository';
import { StakingRefRewardRepository } from 'src/payment/models/staking-ref-reward/staking-ref-reward.repository';
import { StakingRewardRepository } from 'src/payment/models/staking-reward/staking-reward.respository';
import { getCustomRepository, In, IsNull, Not } from 'typeorm';

interface PaymentData {
  lastOutputDates: LastOutputDates;
  incomplete: IncompleteTransactions;
  bankTxWithoutType: number;
  freeDeposit: number;
  unhandledCryptoInputs: number;
}

interface LastOutputDates {
  buyCrypto: Date;
  buyFiat: Date;
  stakingReward: Date;
}

interface IncompleteTransactions {
  buyCrypto: number;
  buyFiat: number;
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
        where: [
          {
            type: Not(In([CryptoInputType.CRYPTO_CRYPTO, CryptoInputType.CRYPTO_STAKING])),
            buyFiat: { id: IsNull() },
            cryptoStaking: { id: IsNull() },
            buyCrypto: { id: IsNull() },
          },
          // ignore staking deposits with failed AML check
          {
            type: CryptoInputType.CRYPTO_STAKING,
            cryptoStaking: { id: IsNull() },
            amlCheck: AmlCheck.PASS,
          },
        ],
        relations: ['buyFiat', 'cryptoStaking', 'buyCrypto'],
      }),
    };
  }

  private async getIncompleteTransactions(): Promise<IncompleteTransactions> {
    return {
      buyCrypto: await getCustomRepository(BuyCryptoRepository).count({
        mailSendDate: IsNull(),
        amlCheck: Not(AmlCheck.FAIL),
      }),
      buyFiat: await getCustomRepository(BuyFiatRepository).count({
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
      buyFiat: await getCustomRepository(BuyFiatRepository)
        .findOne({ order: { outputDate: 'DESC' } })
        .then((b) => b.outputDate),
      stakingReward: await getCustomRepository(StakingRewardRepository)
        .findOne({ order: { outputDate: 'DESC' } })
        .then((b) => b.outputDate),
    };
  }
}
