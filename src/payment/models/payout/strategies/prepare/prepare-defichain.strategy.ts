import { Injectable } from '@nestjs/common';
import { DexService } from 'src/payment/models/dex/services/dex.service';
import { PayoutOrder } from '../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../../services/payout-defichain.service';
import { PrepareStrategy } from './base/prepare.strategy';

@Injectable()
export class PrepareDeFiChainStrategy implements PrepareStrategy {
  constructor(
    private readonly dexService: DexService,
    private readonly defichainService: PayoutDeFiChainService,
    private readonly payoutOrderRepo: PayoutOrderRepository,
  ) {}

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

        await this.payoutOrderRepo.save(order);
      }
    } catch (e) {
      console.error(`Error in checking completion of funds transfer for payout order. Order ID: ${order.id}`, e);
      // TODO - double check the error handling inside a loop
      // continue;
    }
  }
}
