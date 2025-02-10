import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { CheckoutBalances, CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';

interface CheckoutData {
  name: string;
  currency: string;
  balance: CheckoutBalances;
  description: string;
}

@Injectable()
export class CheckoutObserver extends MetricObserver<CheckoutData[]> {
  protected readonly logger = new DfxLogger(CheckoutObserver);

  constructor(monitoringService: MonitoringService, private readonly checkoutService: CheckoutService) {
    super(monitoringService, 'checkout', 'balance');
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.MONITORING, timeout: 1800 })
  async fetch() {
    const data = await this.getCheckout();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getCheckout(): Promise<CheckoutData[]> {
    const balances = await this.checkoutService.getBalances();

    return balances.map((b) => ({
      name: 'Checkout',
      currency: b.holding_currency,
      balance: b.balances,
      description: b.descriptor,
    }));
  }
}
