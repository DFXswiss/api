import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-bitcoin-based.service';
import { PayoutMoneroService } from '../../../services/payout-monero.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';

@Injectable()
export class MoneroStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(MoneroStrategy);

  private readonly averageTransactionSize = 1600; // Bytes

  constructor(
    notificationService: NotificationService,
    protected readonly payoutMoneroService: PayoutMoneroService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, payoutMoneroService);
  }

  get blockchain(): Blockchain {
    return Blockchain.MONERO;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async estimateFee(): Promise<FeeResult> {
    const feeRate = await this.payoutMoneroService.getEstimatedFee();
    const feeAmount = this.averageTransactionSize * feeRate;

    return { asset: await this.feeAsset(), amount: feeAmount };
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const payoutGroups = this.createPayoutGroups(orders, 15);

    for (const group of payoutGroups) {
      try {
        if (group.length === 0) continue;

        const unlockedBalance = await this.payoutMoneroService.getUnlockedBalance();
        const affordableOrders = this.getAffordableOrders(group, unlockedBalance);

        if (affordableOrders.length === 0) {
          const firstOrderAmount = group[0].amount;
          this.logger.info(
            `Insufficient unlocked balance for XMR group. Need: ${firstOrderAmount}, Have: ${unlockedBalance}. ` +
              `Order ID(s): ${group.map((o) => o.id)}`,
          );
          continue;
        }

        if (affordableOrders.length < group.length) {
          const skippedOrders = group.slice(affordableOrders.length);
          this.logger.info(
            `Reduced XMR group from ${group.length} to ${affordableOrders.length} orders due to insufficient balance. ` +
              `Skipped Order ID(s): ${skippedOrders.map((o) => o.id)}`,
          );
        }

        this.logger.verbose(
          `Paying out ${affordableOrders.length} XMR order(s). Order ID(s): ${affordableOrders.map((o) => o.id)}`,
        );

        await this.sendXMR(context, affordableOrders);
      } catch (e) {
        this.logger.error(
          `Error in paying out a group of ${group.length} XMR order(s). Order ID(s): ${group.map((o) => o.id)}`,
          e,
        );
        continue;
      }
    }
  }

  private getAffordableOrders(orders: PayoutOrder[], maxAmount: number): PayoutOrder[] {
    const result: PayoutOrder[] = [];
    let total = 0;

    for (const order of orders) {
      if (total + order.amount > maxAmount) break;
      result.push(order);
      total += order.amount;
    }

    return result;
  }

  protected dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.payoutMoneroService.sendToMany(context, payout);
  }

  async getFeeAsset(): Promise<Asset> {
    return this.assetService.getMoneroCoin();
  }

  private async sendXMR(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    await this.send(context, orders);
  }
}
