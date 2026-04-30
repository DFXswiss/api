import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutArkService } from '../../../services/payout-ark.service';
import { PayoutStrategy } from './base/payout.strategy';

@Injectable()
export class ArkStrategy extends PayoutStrategy {
  protected readonly logger = new DfxLogger(ArkStrategy);

  constructor(
    protected readonly arkService: PayoutArkService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly assetService: AssetService,
  ) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.ARK;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  async estimateFee(): Promise<FeeResult> {
    return {
      asset: await this.feeAsset(),
      amount: 0,
    };
  }

  async estimateBlockchainFee(_a: Asset): Promise<FeeResult> {
    return this.estimateFee();
  }

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const txId = await this.dispatchPayout(order);
        order.pendingPayout(txId);

        await this.payoutOrderRepo.save(order);
      } catch (e) {
        this.logger.error(`Error while executing Ark payout order ${order.id}:`, e);
      }
    }
  }

  async checkPayoutCompletionData(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const [isComplete, payoutFee] = await this.getPayoutCompletionData(order.payoutTxId);

        if (isComplete) {
          order.complete();

          const feeAsset = await this.feeAsset();
          const price = await this.pricingService.getPrice(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
          order.recordPayoutFee(feeAsset, payoutFee, price.convert(payoutFee, Config.defaultVolumeDecimal));

          await this.payoutOrderRepo.save(order);
        }
      } catch (e) {
        this.logger.error(`Error in checking completion of Ark payout order ${order.id}:`, e);
      }
    }
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    return this.arkService.getPayoutCompletionData(payoutTxId);
  }

  protected getCurrentGasForTransaction(token: Asset): Promise<number> {
    return this.arkService.getCurrentFeeForTransaction(token);
  }

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.arkService.sendTransaction(order.destinationAddress, order.amount);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getArkCoin();
  }
}
