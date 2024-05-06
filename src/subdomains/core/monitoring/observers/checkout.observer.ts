import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';

interface CheckoutData {
  name: string;
  currency: string;
  balance: { available: number; collateral: number; payable: number; pending: number };
  description: string;
}

@Injectable()
export class CheckoutObserver extends MetricObserver<CheckoutData[]> {
  protected readonly logger = new DfxLogger(CheckoutObserver);

  constructor(monitoringService: MonitoringService, private readonly checkoutService: CheckoutService) {
    super(monitoringService, 'checkout', 'balance');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async fetch() {
    if (DisabledProcess(Process.MONITORING)) return;

    let data = [];

    data = data.concat(await this.getCheckout());
    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getCheckout(): Promise<CheckoutData[]> {
    const balances = await this.checkoutService.getBalances();

    const checkoutData = [];
    for (const balance of balances) {
      checkoutData.push({
        name: 'Checkout',
        currency: balance.holding_currency,
        balance: balance.balances,
        description: balance.descriptor,
      });
    }
    return checkoutData;
  }
}
