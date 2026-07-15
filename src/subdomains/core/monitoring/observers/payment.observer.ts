import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { FRICK_TERMINAL_STATES } from 'src/integration/bank/dto/frick.dto';
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
import { CustodyIncomingTypes, CustodyOrderStatus } from '../../custody/enums/custody';
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
  stuckFiatOutputs: number;
  pendingCustodyOrders: number;
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

  constructor(
    monitoringService: MonitoringService,
    private readonly repos: RepositoryFactory,
  ) {
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
        .select('deposit.blockchains', 'blockchains')
        .addSelect('COUNT(deposit.blockchains)', 'count')
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
        created: LessThan(Util.hoursBefore(1)),
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
      // Three independent stuck conditions, OR'd together. `health.controller.ts` turns any
      // stuckFiatOutputs > 0 into DEGRADED, so every clause here must be scoped as tightly as the
      // condition it actually names - a clause that matches unrelated, long-settled non-Frick rows
      // would misreport deploy-time health with zero Frick activity involved.
      // 1. Never transmitted (the original condition) - stale readiness, any bank.
      // 2. A Bank Frick order reached a definitive terminal state without ever completing - the
      //    row already has isTransmittedDate set, so clause 1 alone can never see it.
      // 3. Frick-specific safety net: a Frick payout (frickCustomId set) transmitted and still not
      //    complete after 48h - catches an ambiguous/unmatched outgoing bank_tx for Frick that
      //    clauses 1 and 2 don't name explicitly. Scoped to frickCustomId, not every bank: production
      //    has months-old, perfectly settled non-Frick rows that would otherwise match this clause on
      //    every check and report DEGRADED with no Frick activity at all. Deliberately 48h, not 24h:
      //    a legitimate SEPA/instant payout can still be mid-settlement across a weekend or bank
      //    holiday at the 24h mark, and this clause is a monitoring signal a human checks, not an
      //    automated action - a few extra hours of detection latency is the right trade against
      //    false-positive alert noise.
      stuckFiatOutputs: await this.repos.fiatOutput.countBy([
        { isReadyDate: LessThan(Util.hoursBefore(1)), isTransmittedDate: IsNull(), isComplete: false },
        { frickOrderStatus: In(FRICK_TERMINAL_STATES), isComplete: false },
        { frickCustomId: Not(IsNull()), isTransmittedDate: LessThan(Util.hoursBefore(48)), isComplete: false },
      ]),
      pendingCustodyOrders: await this.repos.custodyOrder.countBy({
        status: CustodyOrderStatus.CONFIRMED,
        type: Not(In(CustodyIncomingTypes)),
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
        .then((b) => b?.outputDate),
      buyFiat: await this.repos.buyFiat
        .findOne({ where: {}, order: { outputDate: 'DESC' } })
        .then((b) => b?.outputDate),
    };
  }
}
