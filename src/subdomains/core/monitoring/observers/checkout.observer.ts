import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';

interface CheckoutData {
  name: string;
  currency: string;
  balance: number;
  dbBalance: number;
  difference: number;
}

@Injectable()
export class CheckoutObserver extends MetricObserver<CheckoutData[]> {
  protected readonly logger = new DfxLogger(CheckoutObserver);

  constructor(
    monitoringService: MonitoringService,
    private readonly checkoutService: CheckoutService,
    private readonly repos: RepositoryFactory,
  ) {
    super(monitoringService, 'checkout', 'balance');
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  @Lock(1800)
  async fetch() {
    //  if (DisabledProcess(Process.MONITORING)) return;

    let data = [];

    data = data.concat(await this.getCheckout());
    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getCheckout(): Promise<CheckoutData> {
    const { balance } = await this.checkoutService.getBalance();
    const dbBalance = await this.getDbBalance();

    return {
      name: 'Checkout',
      currency: 'EUR',
      balance,
      dbBalance: Util.round(dbBalance, 2),
      difference: balance - Util.round(dbBalance, 2),
    };
  }

  private async getDbBalance(): Promise<number> {
    const { dbBalance } = await this.repos.checkoutTx
      .createQueryBuilder('checkoutTx')
      .select(
        "SUM(CASE WHEN checkoutTx.status = 'Refunded' THEN checkoutTx.amount * -1 ELSE checkoutTx.amount END)",
        'dbBalance',
      )
      .getRawOne<{ dbBalance: number }>();

    return dbBalance;
  }
}
