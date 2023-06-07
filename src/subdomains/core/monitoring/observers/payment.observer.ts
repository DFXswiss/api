import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { In, IsNull, Not } from 'typeorm';
import { AmlCheck } from '../../buy-crypto/process/enums/aml-check.enum';

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
  protected readonly logger = new DfxLogger(PaymentObserver);

  constructor(monitoringService: MonitoringService, private readonly repos: RepositoryFactory) {
    super(monitoringService, 'payment', 'combined');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock(1800)
  async fetch() {
    if (Config.processDisabled(Process.MONITORING)) return;

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
      freeDeposit: await this.repos.deposit
        .createQueryBuilder('deposit')
        .leftJoin('deposit.route', 'route')
        .where('route.id IS NULL')
        .getCount(),
      unhandledCryptoInputs: await this.repos.payIn.countBy({
        amlCheck: Not(AmlCheck.FAIL),
        status: Not(
          In([
            PayInStatus.FAILED,
            PayInStatus.IGNORED,
            PayInStatus.RETURNED,
            PayInStatus.FORWARDED,
            PayInStatus.COMPLETED,
          ]),
        ),
      }),
    };
  }

  private async getIncompleteTransactions(): Promise<IncompleteTransactions> {
    return {
      buyCrypto: await this.repos.buyCrypto.countBy({
        mailSendDate: IsNull(),
        amlCheck: Not(AmlCheck.FAIL),
      }),
      buyFiat: await this.repos.buyFiat.countBy({
        mail3SendDate: IsNull(),
        amlCheck: Not(AmlCheck.FAIL),
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
