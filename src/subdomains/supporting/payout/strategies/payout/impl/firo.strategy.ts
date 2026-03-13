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
import { PayoutFiroService } from '../../../services/payout-firo.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';

@Injectable()
export class FiroStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(FiroStrategy);

  private readonly averageTransactionSize = 225; // bytes (Firo Legacy P2PKH, no SegWit)

  constructor(
    notificationService: NotificationService,
    protected readonly firoService: PayoutFiroService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, firoService);
  }

  get blockchain(): Blockchain {
    return Blockchain.FIRO;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async estimateFee(): Promise<FeeResult> {
    const feeRate = await this.firoService.getCurrentFeeRate();
    const satoshiFeeAmount = this.averageTransactionSize * feeRate;
    const firoFeeAmount = Util.round(satoshiFeeAmount / 100000000, 8);

    return { asset: await this.feeAsset(), amount: firoFeeAmount };
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const payoutGroups = this.createPayoutGroups(orders, 100);

    for (const group of payoutGroups) {
      try {
        if (group.length === 0) {
          continue;
        }

        this.logger.verbose(`Paying out ${group.length} FIRO orders(s). Order ID(s): ${group.map((o) => o.id)}`);

        await this.sendFIRO(context, group);
      } catch (e) {
        this.logger.error(
          `Error in paying out a group of ${group.length} FIRO orders(s). Order ID(s): ${group.map((o) => o.id)}`,
          e,
        );
        // continue with next group in case payout failed
        continue;
      }
    }
  }

  protected dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.firoService.sendUtxoToMany(context, payout);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getFiroCoin();
  }

  private async sendFIRO(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    await this.send(context, orders);
  }
}
