import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningAddressType, LightningHelper } from 'src/integration/lightning/lightning-helper';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutLightningService } from '../../../services/payout-lightning.service';
import { PayoutStrategy } from './base/payout.strategy';

@Injectable()
export class LightningStrategy extends PayoutStrategy {
  private readonly logger = new DfxLogger(LightningStrategy);

  constructor(
    private readonly assetService: AssetService,
    private readonly payoutLightningService: PayoutLightningService,
    private readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.LIGHTNING;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    if (await this.isHealthy()) {
      for (const order of orders) {
        try {
          const address = order.destinationAddress;
          const amount = order.amount;

          const addressType = LightningHelper.getAddressType(address);

          switch (addressType) {
            case LightningAddressType.LN_URL: {
              const txId = await this.payoutLightningService.sendPaymentByLnurl(address, amount);
              await this.finishDoPayout(order, txId);
              break;
            }

            case LightningAddressType.LN_NID: {
              const txId = await this.payoutLightningService.sendPaymentByLnnid(address, amount);
              await this.finishDoPayout(order, txId);
              break;
            }

            default:
              this.logger.error(`Unknown address type ${addressType} in Lightning payout order ${order.id}`);
          }
        } catch (e) {
          this.logger.error(`Error while executing Lightning payout order ${order.id}:`, e);
        }
      }
    }
  }

  private async finishDoPayout(order: PayoutOrder, txId: string): Promise<void> {
    order.pendingPayout(txId);
    await this.payoutOrderRepo.save(order);
  }

  async checkPayoutCompletionData(orders: PayoutOrder[]): Promise<void> {
    if (await this.isHealthy()) {
      for (const order of orders) {
        try {
          const [isComplete, payoutFee] = await this.payoutLightningService.getPayoutCompletionData(order.payoutTxId);

          if (isComplete) {
            order.complete();
            order.recordPayoutFee(await this.feeAsset(), payoutFee);
            await this.payoutOrderRepo.save(order);
          }
        } catch (e) {
          this.logger.error(`Error in checking completion of Lightning payout order ${order.id}:`, e);
        }
      }
    }
  }

  private async isHealthy(): Promise<boolean> {
    try {
      return await this.payoutLightningService.isHealthy();
    } catch (e) {
      this.logger.error('Error in checking health state of Lightning Node', e);
      return false;
    }
  }

  async estimateFee(asset: Asset): Promise<FeeResult> {
    return { asset, amount: 0 };
  }

  async getFeeAsset(): Promise<Asset> {
    return this.assetService.getLightningCoin();
  }
}
