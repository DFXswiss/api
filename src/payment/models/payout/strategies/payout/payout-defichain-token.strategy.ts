import { Injectable } from '@nestjs/common';
import { DexService } from 'src/payment/models/dex/services/dex.service';
import { MailService } from 'src/shared/services/mail.service';
import { PayoutOrderContext, PayoutOrder } from '../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../../services/payout-defichain.service';
import { PayoutDeFiChainStrategy } from './base/payout-defichain.strategy';

type TokenName = string;

@Injectable()
export class PayoutDeFiChainTokenStrategy extends PayoutDeFiChainStrategy {
  constructor(
    mailService: MailService,
    private readonly dexService: DexService,
    protected readonly defichainService: PayoutDeFiChainService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(mailService, payoutOrderRepo, defichainService);
    this.defichainService.sendTokenToMany = this.defichainService.sendTokenToMany.bind(this.defichainService);
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const tokenGroups = this.groupOrdersByTokens(orders);

    for (const [tokenName, tokenGroup] of [...tokenGroups.entries()]) {
      const payoutGroups = this.createPayoutGroups(tokenGroup, 10);

      for (const group of payoutGroups) {
        try {
          if (group.length === 0) {
            continue;
          }

          console.info(`Paying out ${group.length} token orders(s). Order ID(s): ${group.map((o) => o.id)}`);

          await this.checkUtxoForGroup(group);
          await this.sendToken(context, group, tokenName);
        } catch (e) {
          console.error(
            `Error in paying out a group of ${group.length} token orders(s). Order ID(s): ${group.map((o) => o.id)}`,
          );
          // continue with next group in case payout failed
          continue;
        }
      }
    }
  }

  protected groupOrdersByTokens(orders: PayoutOrder[]): Map<TokenName, PayoutOrder[]> {
    const groups = new Map<TokenName, PayoutOrder[]>();

    orders.forEach((order) => {
      const existingGroup = groups.get(order.asset.dexName);

      if (existingGroup) {
        existingGroup.push(order);
      } else {
        groups.set(order.asset.dexName, [order]);
      }
    });

    return groups;
  }

  private async checkUtxoForGroup(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      if (this.isEligibleForMinimalUtxo(order.destinationAddress)) {
        await this.checkUtxo(order.destinationAddress);
      }
    }
  }

  private isEligibleForMinimalUtxo(address: string): boolean {
    return this.defichainService.isUserAddress(address);
  }

  private async checkUtxo(address: string): Promise<void> {
    const utxo = await this.defichainService.getUtxoForAddress(address);

    if (!utxo) {
      await this.dexService.transferMinimalUtxo(address);
    }
  }

  private async sendToken(context: PayoutOrderContext, orders: PayoutOrder[], outputAsset: string): Promise<void> {
    await this.send(context, orders, outputAsset, this.defichainService.sendTokenToMany);
  }
}
