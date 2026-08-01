import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '../entities/payout-order.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class PayoutLogService {
  private readonly logger = new DfxLogger(PayoutLogService);

  logTransferCompletion(confirmedOrders: PayoutOrder[]): void {
    const confirmedOrdersLogs = this.createDefaultOrdersLog(confirmedOrders);

    if (confirmedOrders.length)
      this.logger.verbose(`Prepared funds for ${confirmedOrders.length} payout order(s): ${confirmedOrdersLogs}`);
  }

  logPayoutCompletion(confirmedOrders: PayoutOrder[]): void {
    const confirmedOrdersLogs = this.createDefaultOrdersLog(confirmedOrders);

    if (confirmedOrders.length)
      this.logger.verbose(`Completed ${confirmedOrders.length} payout order(s): ${confirmedOrdersLogs}`);
  }

  logNewPayoutOrders(newOrders: PayoutOrder[]): void {
    const newOrdersLogs = this.createDefaultOrdersLog(newOrders);

    if (newOrders.length) this.logger.verbose(`Processing ${newOrders.length} new payout order(s): ${newOrdersLogs}`);
  }

  logFailedOrders(failedOrders: PayoutOrder[]): string {
    const failedOrdersLogs = this.createDefaultOrdersLog(failedOrders);
    const message = `${failedOrders.length} payout order(s) failed and pending investigation: ${failedOrdersLogs}`;

    if (failedOrders.length) {
      this.logger.error(message);

      // One line per order in addition to the summary above: the summary collapses an arbitrary number of orders into
      // a single line, so a reader (human or monitoring) only sees the whole batch by parsing a variable-length list.
      // These lines carry what is needed to judge the escalation without a DB lookup - the payout amount, its asset
      // and the chain it was going out on. The summary line is left as it is because processFailedOrders in
      // payout.service.ts hands its return value to createMailRequest, which puts it into the escalation mail.
      for (const order of failedOrders) this.logger.error(this.createEscalationLog(order));
    }

    return message;
  }

  //*** HELPER METHODS ***//

  private createDefaultOrdersLog(orders: PayoutOrder[]): string[] {
    return orders.map((o) => `[Order ID: ${o.id}, Context: ${o.context}, CorrelationID: ${o.correlationId}] `);
  }

  // Treat the wording and the field order as an interface, not as prose: log-based monitoring parses this line
  // positionally, and the pinning test in __tests__ fails if the shape changes.
  //
  // `amount` is numeric and `chain`/`context` are enum values, so a bare literal fence holds for them by construction.
  // The free-form values - the asset name and the correlation id - are JSON-encoded instead, and that is a deliberate
  // choice over fencing them with a plain quote. A plain quote only works as long as no value contains one, and both
  // ways of reading such a field are forgeable: read up to the FIRST quote and a name like `Foo" on chain Ethereum`
  // closes its own field and imitates the next fence; read up to the LAST one and any later free-form field can offer
  // a competing fence instead. Both produce a wrong chain with no parse error - a silently wrong value in a critical
  // alert, which is worse than a loud one. JSON encoding removes the class rather than moving it: a quote inside the
  // value comes out escaped, so the closing quote is unambiguous no matter what the value contains.
  // `||` rather than `??` on purpose: an empty name would encode to "" and read back as empty rather than as a name.
  private createEscalationLog(order: PayoutOrder): string {
    return `Payout order ${order.id} escalated to PayoutUncertain: amount ${order.amount} of ${JSON.stringify(
      order.asset?.name || 'unknown',
    )} on chain ${order.chain}, context ${order.context}, correlation ${JSON.stringify(order.correlationId ?? '')}`;
  }
}
