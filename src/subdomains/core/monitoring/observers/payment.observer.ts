import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { PayInAction, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { In, IsNull, LessThan, Not } from 'typeorm';
import { CheckStatus } from '../../aml/enums/check-status.enum';
import { PaymentQuoteStatus } from '../../payment-link/enums';
import { RewardStatus } from '../../referral/reward/ref-reward.entity';

interface PaymentData {
  lastOutputDates: LastOutputDates;
  incomplete: IncompleteTransactions;
  freeDeposit: { blockchain: string; count: number }[];
  unhandledCryptoInputs: number;
  unconfirmedCryptoInputs: number;
  bankTxWithoutType: number;
  bankTxGsType: number;
  refRewardManualCheck: number;
  stuckPayments: number;
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
  protected readonly logger = new DfxLogger(PaymentObserver);

  constructor(monitoringService: MonitoringService, private readonly repos: RepositoryFactory) {
    super(monitoringService, 'payment', 'combined');
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.MONITORING, timeout: 1800 })
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
      bankTxWithoutType: await this.repos.bankTx.countBy({ type: IsNull() }),
      bankTxGsType: await this.repos.bankTx.countBy({ type: BankTxType.GSHEET }),
      freeDeposit: await this.repos.deposit
        .createQueryBuilder('deposit')
        .select('deposit.blockchains, COUNT(deposit.blockchains) as count')
        .leftJoin('deposit.route', 'route')
        .where('route.id IS NULL')
        .groupBy('deposit.blockchains')
        .getRawMany<{ blockchains: string; count: number }>()
        .then((list) =>
          list.map((i) => i.blockchains.split(';').map((b) => ({ blockchain: b, count: i.count }))).flat(),
        ),
      unhandledCryptoInputs: await this.repos.payIn.countBy({
        action: IsNull(),
        status: Not(In([PayInStatus.FAILED, PayInStatus.IGNORED, PayInStatus.RETURN_CONFIRMED])),
        buyCrypto: { id: IsNull() },
        buyFiat: { id: IsNull() },
      }),
      unconfirmedCryptoInputs: await this.repos.payIn.countBy({
        status: Not(
          In([
            PayInStatus.RETURN_CONFIRMED,
            PayInStatus.FORWARD_CONFIRMED,
            PayInStatus.COMPLETED,
            PayInStatus.IGNORED,
            PayInStatus.FAILED,
          ]),
        ),
        action: In([PayInAction.FORWARD, PayInAction.RETURN]),
      }),
      refRewardManualCheck: await this.repos.refReward.countBy({ status: RewardStatus.MANUAL_CHECK }),
      stuckPayments: await this.repos.paymentQuote.countBy({
        status: Not(
          In([
            PaymentQuoteStatus.CANCELLED,
            PaymentQuoteStatus.EXPIRED,
            PaymentQuoteStatus.TX_COMPLETED,
            PaymentQuoteStatus.TX_FAILED,
          ]),
        ),
        created: LessThan(Util.hoursBefore(3)),
      }),
    };
  }

  private async getIncompleteTransactions(): Promise<IncompleteTransactions> {
    return {
      buyCrypto: await this.repos.buyCrypto.countBy({
        mailSendDate: IsNull(),
        amlCheck: Not(CheckStatus.FAIL),
      }),
      buyFiat: await this.repos.buyFiat.countBy({
        mail3SendDate: IsNull(),
        amlCheck: Not(CheckStatus.FAIL),
      }),
    };
  }

  private async getLastOutputDates(): Promise<LastOutputDates> {
    return {
      buyCrypto: await this.repos.buyCrypto
        .findOne({ where: {}, order: { outputDate: 'DESC' } })
        .then((b) => b.outputDate),
      buyFiat: await this.repos.buyFiat.findOne({ where: {}, order: { outputDate: 'DESC' } }).then((b) => b.outputDate),
    };
  }
}
