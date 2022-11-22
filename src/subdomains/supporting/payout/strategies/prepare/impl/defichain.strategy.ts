import { Injectable } from '@nestjs/common';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { PrepareStrategy } from './base/prepare.strategy';

@Injectable()
export class DeFiChainStrategy extends PrepareStrategy {
  constructor(
    private readonly assetService: AssetService,
    private readonly dexService: DexService,
    private readonly defichainService: PayoutDeFiChainService,
    private readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super();
  }

  async preparePayout(order: PayoutOrder): Promise<void> {
    try {
      const { asset, amount, context } = order;

      if (!(await this.defichainService.isHealthy(context))) return;

      const destinationAddress = this.defichainService.getWalletAddress(context);
      const request = { asset, amount, destinationAddress };

      const transferTxId = await this.dexService.transferLiquidity(request);

      order.pendingPreparation(transferTxId);
    } catch (e) {
      console.error(`Error in transferring liquidity for payout order. Order ID: ${order.id}`, e);
      return;
    }

    try {
      await this.payoutOrderRepo.save(order);
    } catch (e) {
      // db failure case, internal transfer - just logging is sufficient
      console.error(`Error in saving liquidity transfer txId to payout order. Order ID: ${order.id}`, e);
    }
  }

  async checkPreparationCompletion(order: PayoutOrder): Promise<void> {
    try {
      if (!(await this.defichainService.isHealthy(order.context))) return;

      const isTransferComplete = await this.dexService.checkTransferCompletion(order.transferTxId);

      if (isTransferComplete) {
        order.preparationConfirmed();
        order.recordPreparationFee(await this.feeAsset(), 0);

        await this.payoutOrderRepo.save(order);
      }
    } catch (e) {
      console.error(`Error in checking completion of funds transfer for payout order. Order ID: ${order.id}`, e);
    }
  }

  async estimateFee(): Promise<FeeResult> {
    return { asset: await this.feeAsset(), amount: 0 };
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }
}
