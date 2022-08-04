import { Injectable } from '@nestjs/common';
import { NodeService } from 'src/ain/node/node.service';
import { MailService } from 'src/shared/services/mail.service';
import { DexService } from '../../dex/services/dex.service';
import { PayoutOrder } from '../entities/payout-order.entity';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';
import { PayoutChainService } from '../services/payout-chain.service';
import { PayoutStrategy } from './payout.strategy';

type TokenName = string;

@Injectable()
export class PayoutTokenStrategy extends PayoutStrategy {
  constructor(
    mailService: MailService,
    readonly nodeService: NodeService,
    private readonly chainService: PayoutChainService,
    private readonly dexService: DexService,
    private readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(mailService);
  }

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    const tokenGroups = this.groupsOrdersByTokens(orders);

    for (const [tokenName, tokenGroup] of [...tokenGroups.entries()]) {
      const payoutGroups = this.createPayoutGroups(tokenGroup, 10);

      for (const group of payoutGroups) {
        await this.sendToken(group, tokenName);
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

  private async sendToken(orders: PayoutOrder[], outputAsset: string): Promise<void> {
    let payoutTxId: string;

    try {
      for (const order of orders) {
        await this.checkUtxo(order.destinationAddress);
      }
      const payout = this.aggregatePayout(orders);

      payoutTxId = await this.chainService.sendTokenToMany(outputAsset, payout);
    } catch (e) {
      console.error(`Error on sending ${outputAsset} for output. Transaction IDs: ${orders.map((t) => t.id)}`, e);
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
    const utxo = await this.chainService.getUtxoForAddress(address);

    if (!parseFloat(utxo)) {
      await this.dexService.transferMinimalUtxo(address);
    }
  }
}
