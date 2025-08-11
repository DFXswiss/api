import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-bitcoin-based.service';
import { PayoutZanoService } from '../../../services/payout-zano.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';

@Injectable()
export class ZanoStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(ZanoStrategy);

  constructor(
    notificationService: NotificationService,
    protected readonly payoutZanoService: PayoutZanoService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, payoutZanoService);
  }

  get blockchain(): Blockchain {
    return Blockchain.ZANO;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async estimateFee(): Promise<FeeResult> {
    const feeAmount = this.payoutZanoService.getEstimatedFee();

    return { asset: await this.feeAsset(), amount: feeAmount };
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    if (!(await this.hasEnoughUnlockedBalance(orders))) {
      this.logger.info(
        `Insufficient unlocked balance for paying out ZANO orders(s). Order ID(s): ${orders.map((o) => o.id)}`,
      );
      return;
    }

    const payoutGroups = this.createPayoutGroups(orders, 15);

    for (const group of payoutGroups) {
      try {
        if (group.length === 0) {
          continue;
        }

        this.logger.verbose(`Paying out ${group.length} ZANO orders(s). Order ID(s): ${group.map((o) => o.id)}`);

        await this.sendZano(context, group);
      } catch (e) {
        this.logger.error(
          `Error in paying out a group of ${group.length} ZANO orders(s). Order ID(s): ${group.map((o) => o.id)}`,
          e,
        );
        // continue with next group in case payout failed
        continue;
      }
    }
  }

  private async hasEnoughUnlockedBalance(orders: PayoutOrder[]): Promise<boolean> {
    const totalOrderAmount = Util.sumObjValue<PayoutOrder>(orders, 'amount');
    const unlockedBalance = await this.payoutZanoService.getUnlockedBalance();

    return totalOrderAmount <= unlockedBalance;
  }

  protected dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.payoutZanoService.sendToMany(context, payout);
  }

  async getFeeAsset(): Promise<Asset> {
    return this.assetService.getZanoCoin();
  }

  private async sendZano(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    await this.send(context, orders, 'ZANO');
  }
}
