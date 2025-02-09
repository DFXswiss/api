import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CheckoutBalances, CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { CheckoutTxService } from 'src/subdomains/supporting/fiat-payin/services/checkout-tx.service';

interface CheckoutData {
  name: string;
  currency: string;
  balance: CheckoutBalances;
  description: string;
  syncDate: Date;
}

@Injectable()
export class CheckoutObserver extends MetricObserver<CheckoutData[]> {
  protected readonly logger = new DfxLogger(CheckoutObserver);

  constructor(
    monitoringService: MonitoringService,
    private readonly checkoutService: CheckoutService,
    private readonly checkoutTxService: CheckoutTxService,
  ) {
    super(monitoringService, 'checkout', 'balance');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async fetch() {
    if (DisabledProcess(Process.MONITORING)) return;

    const data = await this.getCheckout();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getCheckout(): Promise<CheckoutData[]> {
    const balances = await this.checkoutService.getBalances();
    const syncDate = await this.checkoutTxService.getSyncDate();

    return balances.map((b) => ({
      name: 'Checkout',
      currency: b.holding_currency,
      balance: b.balances,
      description: b.descriptor,
      syncDate,
    }));
  }
}
