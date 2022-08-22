import { Injectable } from '@nestjs/common';
import { NodeService } from 'src/ain/node/node.service';
import { MailService } from 'src/shared/services/mail.service';
import { PayoutOrder, PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../services/payout-defichain.service';
import { PayoutStrategy } from './payout.strategy';

@Injectable()
export class PayoutDFIStrategy extends PayoutStrategy {
  constructor(
    mailService: MailService,
    readonly nodeService: NodeService,
    private readonly defichainService: PayoutDeFiChainService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(mailService, payoutOrderRepo);
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const payoutGroups = this.createPayoutGroups(orders, 100);

    for (const group of payoutGroups) {
      try {
        if (group.length === 0) {
          continue;
        }

        console.info(`Paying out ${group.length} DFI orders(s). Order ID(s): ${group.map((o) => o.id)}`);

        await this.sendDFI(context, group);
      } catch (e) {
        console.error(
          `Error in paying out a group of ${group.length} DFI orders(s). Order ID(s): ${group.map((o) => o.id)}`,
        );
        // continue with next group in case payout failed
        continue;
      }
    }
  }

  private async sendDFI(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    let payoutTxId: string;

    try {
      const payout = this.aggregatePayout(orders);

      await this.designatePayout(orders);
      // TODO - retry mechanism? catch only for timeouts?
      payoutTxId = await this.defichainService.sendUtxoToMany(context, payout);
    } catch (e) {
      console.error(`Error on sending DFI for payout. Order ID(s): ${orders.map((o) => o.id)}`, e);
      throw e;
    }

    for (const order of orders) {
      try {
        const paidOrder = order.pendingPayout(payoutTxId);
        await this.payoutOrderRepo.save(paidOrder);
      } catch (e) {
        const errorMessage = `Error on saving payout payoutTxId to the database. Order ID: ${order.id}. Payout ID: ${payoutTxId}`;

        console.error(errorMessage, e);
        this.sendNonRecoverableErrorMail(errorMessage, e);
      }
    }
  }
}
