import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { DepositRepository } from 'src/subdomains/supporting/address-pool/deposit/deposit.repository';
import { getCustomRepository, In, IsNull, Not } from 'typeorm';
import { BankTxRepository } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.repository';
import { AmlCheck } from '../../buy-crypto/process/enums/aml-check.enum';
import { BuyCryptoRepository } from '../../buy-crypto/process/repositories/buy-crypto.repository';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';

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
}

interface IncompleteTransactions {
  buyCrypto: number;
  buyFiat: number;
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
      unhandledCryptoInputs: await getCustomRepository(PayInRepository).count({
        where: {
          amlCheck: Not(AmlCheck.FAIL),
          status: Not(In([PayInStatus.FAILED, PayInStatus.IGNORED, PayInStatus.RETURNED, PayInStatus.FORWARDED])),
        },
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
    };
  }
}
