import { Injectable } from '@nestjs/common';
import { MoneroHelper } from 'src/integration/blockchain/monero/monero-helper';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutMoneroService } from '../../../services/payout-monero.service';
import { PayoutStrategy } from './base/payout.strategy';

@Injectable()
export class MoneroStrategy extends PayoutStrategy {
  private readonly logger = new DfxLogger(MoneroStrategy);

  // TODO: Define the average transaction size for a monero transaction! ...
  private readonly averageTransactionSize = 180; // vBytes

  constructor(
    private readonly assetService: AssetService,
    private readonly payoutMoneroService: PayoutMoneroService,
    private readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.MONERO;
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

          const txId = await this.payoutMoneroService.sendTransfer(address, amount);
          await this.finishDoPayout(order, txId);
        } catch (e) {
          this.logger.error(`Error while executing Monero payout order ${order.id}:`, e);
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
          const [isComplete, payoutFee] = await this.payoutMoneroService.getPayoutCompletionData(order.payoutTxId);

          if (isComplete) {
            order.complete();
            order.recordPayoutFee(await this.feeAsset(), payoutFee);
            await this.payoutOrderRepo.save(order);
          }
        } catch (e) {
          this.logger.error(`Error in checking completion of Monero payout order ${order.id}:`, e);
        }
      }
    }
  }

  async estimateFee(): Promise<FeeResult> {
    const feeRate = await this.payoutMoneroService.getEstimatedFee();
    const feeAmount = this.averageTransactionSize * feeRate;
    const xmrFeeAmount = MoneroHelper.auToXmr(feeAmount);

    return { asset: await this.feeAsset(), amount: xmrFeeAmount };
  }

  private async isHealthy(): Promise<boolean> {
    try {
      return await this.payoutMoneroService.isHealthy();
    } catch (e) {
      this.logger.error('Error in checking health state of Monero Node', e);
      return false;
    }
  }

  async getFeeAsset(): Promise<Asset> {
    return this.assetService.getMoneroCoin();
  }
}
