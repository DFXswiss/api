import { Injectable, NotImplementedException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutLightningService } from '../../../services/payout-lightning.service';
import { PayoutStrategy } from './base/payout.strategy';

@Injectable()
export class LightningStrategy extends PayoutStrategy {
  protected readonly logger: DfxLogger;

  constructor(
    readonly loggerFactory: LoggerFactory,
    private readonly assetService: AssetService,
    private readonly payoutLightningService: PayoutLightningService,
    private readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super();

    this.logger = this.loggerFactory.create(LightningStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.LIGHTNING;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async estimateBlockchainFee(): Promise<FeeResult> {
    return { asset: await this.getFeeAsset(), amount: 0 };
  }

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    if (await this.isHealthy()) {
      for (const order of orders) {
        try {
          const address = order.destinationAddress;
          const amount = order.amount;

          const txId = await this.payoutLightningService.sendPayment(address, amount);
          await this.finishDoPayout(order, txId);
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

            const feeAsset = await this.feeAsset();
            const price = await this.pricingService.getPrice(feeAsset, this.chf, true);
            order.recordPayoutFee(feeAsset, payoutFee, price.convert(payoutFee, Config.defaultVolumeDecimal));

            await this.payoutOrderRepo.save(order);
          }
        } catch (e) {
          this.logger.error(`Error in checking completion of Lightning payout order ${order.id}:`, e);
        }
      }
    }
  }

  private async isHealthy(): Promise<boolean> {
    return this.payoutLightningService.isHealthy();
  }

  async estimateFee(targetAsset: Asset, address: string, amount: number, asset: Asset): Promise<FeeResult> {
    if (targetAsset.id !== asset.id)
      throw new NotImplementedException(
        `Tried to estimate fee with target asset (${targetAsset.uniqueName}) different from ref asset (${asset.uniqueName})`,
      );

    const fee = await this.payoutLightningService.getEstimatedFee(address, amount);
    return { asset: await this.feeAsset(), amount: fee };
  }

  async getFeeAsset(): Promise<Asset> {
    return this.assetService.getLightningCoin();
  }
}
