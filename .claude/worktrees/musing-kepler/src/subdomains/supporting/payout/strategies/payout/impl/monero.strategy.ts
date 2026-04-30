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
    const pendingOrders = [...orders];
    let paidOutOrders = 0;

    while (pendingOrders.length > 0) {
      const unlockedBalance = await this.payoutMoneroService.getUnlockedBalance();
      if (unlockedBalance <= 0) break;

      const group = this.splicePayoutGroup(pendingOrders, unlockedBalance, 15);
      if (group.length === 0) break;

      try {
        await this.sendXMR(context, group);
        paidOutOrders += group.length;
      } catch (e) {
        this.logger.error(`Error paying out XMR orders`, e);
        break;
      }
    }

    if (paidOutOrders > 0 || pendingOrders.length > 0) {
      this.logger.info(
        `XMR payout: ${paidOutOrders} paid, ${pendingOrders.length} pending (insufficient unlocked balance)`,
      );
    }
  }

  private splicePayoutGroup(orders: PayoutOrder[], maxAmount: number, maxSize: number): PayoutOrder[] {
    let total = 0;
    let count = 0;

    for (const order of orders) {
      if (count >= maxSize) break;
      if (total + order.amount > maxAmount) break;

      total += order.amount;
      count++;
    }

    return orders.splice(0, count);
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
