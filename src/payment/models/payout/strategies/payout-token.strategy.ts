import { Injectable } from '@nestjs/common';
import { NodeService } from 'src/ain/node/node.service';
import { MailService } from 'src/shared/services/mail.service';
import { DexService } from '../../dex/services/dex.service';
import { PayoutOrder, PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../services/payout-defichain.service';
import { PayoutStrategy } from './payout.strategy';

type TokenName = string;

@Injectable()
export class PayoutTokenStrategy extends PayoutStrategy {
  constructor(
    mailService: MailService,
    readonly nodeService: NodeService,
    private readonly defichainService: PayoutDeFiChainService,
    private readonly dexService: DexService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(mailService, payoutOrderRepo);
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const tokenGroups = this.groupsOrdersByTokens(orders);

    for (const [tokenName, tokenGroup] of [...tokenGroups.entries()]) {
      const payoutGroups = this.createPayoutGroups(tokenGroup, 10);

      for (const group of payoutGroups) {
        try {
          if (group.length === 0) {
            continue;
          }

          console.info(`Paying out ${group.length} Token orders(s). Order ID(s): ${group.map((o) => o.id)}`);

          await this.sendToken(context, group, tokenName);
        } catch (e) {
          console.error(
            `Error in paying out a group of ${group.length} Token orders(s). Order ID(s): ${group.map((o) => o.id)}`,
          );
          // continue with next group in case payout failed
          continue;
        }
      }
    }
  }

  private groupsOrdersByTokens(orders: PayoutOrder[]): Map<TokenName, PayoutOrder[]> {
    const groups = new Map<TokenName, PayoutOrder[]>();

    orders.forEach((order) => {
      const existingGroup = groups.get(order.asset);

      if (existingGroup) {
        existingGroup.push(order);
      } else {
        groups.set(order.asset, [order]);
      }
    });

    return groups;
  }

  private async sendToken(context: PayoutOrderContext, orders: PayoutOrder[], outputAsset: string): Promise<void> {
    let payoutTxId: string;

    try {
      for (const order of orders) {
        await this.checkUtxo(order.destinationAddress);
      }
      const payout = this.aggregatePayout(orders);

      await this.designatePayout(orders);
      payoutTxId = await this.defichainService.sendTokenToMany(context, outputAsset, payout);
    } catch (e) {
      console.error(`Error on sending ${outputAsset} for payout. Order ID(s): ${orders.map((o) => o.id)}`, e);
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

  private async checkUtxo(address: string): Promise<void> {
    const utxo = await this.defichainService.getUtxoForAddress(address);

    if (!parseFloat(utxo)) {
      await this.dexService.transferMinimalUtxo(address);
    }
  }
}
