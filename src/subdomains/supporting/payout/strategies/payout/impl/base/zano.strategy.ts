import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayoutOrder, PayoutOrderContext } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutOrderRepository } from 'src/subdomains/supporting/payout/repositories/payout-order.repository';
import { PayoutZanoService } from 'src/subdomains/supporting/payout/services/payout-zano.service';
import { BitcoinBasedStrategy } from './bitcoin-based.strategy';

export abstract class ZanoStrategy extends BitcoinBasedStrategy {
  constructor(
    readonly notificationService: NotificationService,
    readonly payoutOrderRepo: PayoutOrderRepository,
    readonly payoutZanoService: PayoutZanoService,
    readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, payoutZanoService);
  }

  async estimateFee(): Promise<FeeResult> {
    const feeAmount = this.payoutZanoService.getEstimatedFee();

    return { asset: await this.feeAsset(), amount: feeAmount };
  }

  abstract hasEnoughUnlockedBalance(orders: PayoutOrder[]): Promise<boolean>;

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const payoutGroups = this.createPayoutGroups(orders, 15);

    for (const group of payoutGroups) {
      try {
        if (group.length === 0) {
          continue;
        }

        if (await this.hasEnoughUnlockedBalance(group)) {
          this.logger.verbose(`Paying out ${group.length} Zano orders(s). Order ID(s): ${group.map((o) => o.id)}`);

          await this.sendOrder(context, group);
        } else {
          this.logger.info(
            `Insufficient unlocked balance for paying out Zano orders(s). Order ID(s): ${group.map((o) => o.id)}`,
          );
        }
      } catch (e) {
        this.logger.error(
          `Error in paying out a group of ${group.length} Zano orders(s). Order ID(s): ${group.map((o) => o.id)}`,
          e,
        );
        // continue with next group in case payout failed
        continue;
      }
    }
  }

  async getFeeAsset(): Promise<Asset> {
    return this.assetService.getZanoCoin();
  }

  private async sendOrder(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    await this.send(context, orders);
  }
}
