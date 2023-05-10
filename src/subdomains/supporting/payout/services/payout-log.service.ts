import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '../entities/payout-order.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class PayoutLogService {
  private readonly logger = new DfxLogger(PayoutLogService);

  logTransferCompletion(confirmedOrders: PayoutOrder[]): void {
    const confirmedOrdersLogs = this.createDefaultOrdersLog(confirmedOrders);

    confirmedOrders.length &&
      this.logger.info(`Prepared funds for ${confirmedOrders.length} payout order(s): ${confirmedOrdersLogs}`);
  }

  logPayoutCompletion(confirmedOrders: PayoutOrder[]): void {
    const confirmedOrdersLogs = this.createDefaultOrdersLog(confirmedOrders);

    confirmedOrders.length &&
      this.logger.info(`Completed ${confirmedOrders.length} payout order(s): ${confirmedOrdersLogs}`);
  }

  logNewPayoutOrders(newOrders: PayoutOrder[]): void {
    const newOrdersLogs = this.createDefaultOrdersLog(newOrders);

    newOrders.length && this.logger.info(`Processing ${newOrders.length} new payout order(s): ${newOrdersLogs}`);
  }

  logFailedOrders(failedOrders: PayoutOrder[]): string {
    const failedOrdersLogs = this.createDefaultOrdersLog(failedOrders);
    const message = `${failedOrders.length} payout order(s) failed and pending investigation: ${failedOrdersLogs}`;

    failedOrders.length && this.logger.info(message);

    return message;
  }

  //*** HELPER METHODS ***//

  private createDefaultOrdersLog(orders: PayoutOrder[]): string[] {
    return orders.map((o) => `[Order ID: ${o.id}, Context: ${o.context}, CorrelationID: ${o.correlationId}] `);
  }
}
