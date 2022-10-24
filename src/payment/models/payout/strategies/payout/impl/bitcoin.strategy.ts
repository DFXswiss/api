import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { NotificationService } from 'src/notification/services/notification.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-jellyfish.service';
import { PayoutBitcoinService } from '../../../services/payout-bitcoin.service';
import { JellyfishStrategy } from './base/jellyfish.strategy';

@Injectable()
export class BitcoinStrategy extends JellyfishStrategy {
  constructor(
    notificationService: NotificationService,
    protected readonly bitcoinService: PayoutBitcoinService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, bitcoinService);
  }

  async estimateFee(quantityOfTransactions: number): Promise<FeeResult> {
    const feeRate = await this.bitcoinService.getCurrentFastestFeeRate();
    const satoshiFeeAmount = (200 + 50 * quantityOfTransactions) * feeRate;
    const btcFeeAmount = satoshiFeeAmount / 100000000;

    return { asset: await this.feeAsset(), amount: btcFeeAmount };
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const payoutGroups = this.createPayoutGroups(orders, 100);

    for (const group of payoutGroups) {
      try {
        if (group.length === 0) {
          continue;
        }

        console.info(`Paying out ${group.length} BTC orders(s). Order ID(s): ${group.map((o) => o.id)}`);

        await this.sendBTC(context, group);
      } catch (e) {
        console.error(
          `Error in paying out a group of ${group.length} BTC orders(s). Order ID(s): ${group.map((o) => o.id)}`,
        );
        // continue with next group in case payout failed
        continue;
      }
    }
  }

  protected dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.bitcoinService.sendUtxoToMany(context, payout);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({ dexName: 'BTC', blockchain: Blockchain.BITCOIN });
  }

  private async sendBTC(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    await this.send(context, orders, 'BTC');
  }
}
