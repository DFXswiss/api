import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-jellyfish.service';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { JellyfishStrategy } from './base/jellyfish.strategy';

@Injectable()
export class DeFiChainCoinStrategy extends JellyfishStrategy {
  protected readonly logger = new DfxLogger(DeFiChainCoinStrategy);

  constructor(
    notificationService: NotificationService,
    protected readonly deFiChainService: PayoutDeFiChainService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, deFiChainService);
  }

  get blockchain(): Blockchain {
    return Blockchain.DEFICHAIN;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  async estimateFee(): Promise<FeeResult> {
    return { asset: await this.feeAsset(), amount: 0 };
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const payoutGroups = this.createPayoutGroups(orders, 100);

    for (const group of payoutGroups) {
      try {
        if (group.length === 0) {
          continue;
        }

        this.logger.verbose(`Paying out ${group.length} DFI orders(s). Order ID(s): ${group.map((o) => o.id)}`);

        await this.sendDFI(context, group);
      } catch (e) {
        this.logger.error(
          `Error in paying out a group of ${group.length} DFI orders(s). Order ID(s): ${group.map((o) => o.id)}:`,
          e,
        );
        // continue with next group in case payout failed
        continue;
      }
    }
  }

  protected dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.deFiChainService.sendUtxoToMany(context, payout);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }

  private async sendDFI(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    await this.send(context, orders, 'DFI');
  }
}
