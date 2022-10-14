import { Injectable } from '@nestjs/common';
import { DexService } from 'src/payment/models/dex/services/dex.service';
import { MailService } from 'src/shared/services/mail.service';
import { PayoutOrderContext, PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-jellyfish.service';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { JellyfishStrategy } from './base/jellyfish.strategy';

type TokenName = string;

@Injectable()
export class DeFiChainTokenStrategy extends JellyfishStrategy {
  constructor(
    mailService: MailService,
    private readonly dexService: DexService,
    protected readonly jellyfishService: PayoutDeFiChainService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(mailService, payoutOrderRepo, jellyfishService);
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
    return this.jellyfishService.isLightWalletAddress(address);
  }

  private async checkUtxo(address: string): Promise<void> {
    const utxo = await this.jellyfishService.getUtxoForAddress(address);

    if (!utxo) {
      await this.dexService.transferMinimalUtxo(address);
    }
  }

  protected dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup, outputAsset: string): Promise<string> {
    return this.jellyfishService.sendTokenToMany(context, payout, outputAsset);
  }

  private async sendToken(context: PayoutOrderContext, orders: PayoutOrder[], outputAsset: string): Promise<void> {
    await this.send(context, orders, outputAsset);
  }
}
