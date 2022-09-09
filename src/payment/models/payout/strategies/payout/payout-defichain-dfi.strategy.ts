import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { PayoutOrder, PayoutOrderContext } from '../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../../services/payout-defichain.service';
import { PayoutDeFiChainStrategy } from './base/payout-defichain.strategy';

@Injectable()
export class PayoutDeFiChainDFIStrategy extends PayoutDeFiChainStrategy {
  constructor(
    mailService: MailService,
    protected readonly defichainService: PayoutDeFiChainService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(mailService, payoutOrderRepo, defichainService);
    this.defichainService.sendUtxoToMany = this.defichainService.sendUtxoToMany.bind(this.defichainService);
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
    await this.send(context, orders, 'DFI', this.defichainService.sendUtxoToMany);
  }
}
