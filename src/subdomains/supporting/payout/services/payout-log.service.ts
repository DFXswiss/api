import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { PayoutOrder } from '../entities/payout-order.entity';

@Injectable()
export class PayoutLogService {
  private readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create(PayoutLogService);
  }

  logTransferCompletion(confirmedOrders: PayoutOrder[]): void {
    const confirmedOrdersLogs = this.createDefaultOrdersLog(confirmedOrders);

    confirmedOrders.length &&
      this.logger.verbose(`Prepared funds for ${confirmedOrders.length} payout order(s): ${confirmedOrdersLogs}`);
  }

  logPayoutCompletion(confirmedOrders: PayoutOrder[]): void {
    const confirmedOrdersLogs = this.createDefaultOrdersLog(confirmedOrders);

    confirmedOrders.length &&
      this.logger.verbose(`Completed ${confirmedOrders.length} payout order(s): ${confirmedOrdersLogs}`);
  }

  logNewPayoutOrders(newOrders: PayoutOrder[]): void {
    const newOrdersLogs = this.createDefaultOrdersLog(newOrders);

    newOrders.length && this.logger.verbose(`Processing ${newOrders.length} new payout order(s): ${newOrdersLogs}`);
  }

  logFailedOrders(failedOrders: PayoutOrder[]): string {
    const failedOrdersLogs = this.createDefaultOrdersLog(failedOrders);
    const message = `${failedOrders.length} payout order(s) failed and pending investigation: ${failedOrdersLogs}`;

    failedOrders.length && this.logger.error(message);

    return message;
  }

  //*** HELPER METHODS ***//

  private createDefaultOrdersLog(orders: PayoutOrder[]): string[] {
    return orders.map((o) => `[Order ID: ${o.id}, Context: ${o.context}, CorrelationID: ${o.correlationId}] `);
  }
}
