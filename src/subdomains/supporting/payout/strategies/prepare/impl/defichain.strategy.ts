import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { TransferNotRequiredException } from 'src/subdomains/supporting/dex/exceptions/transfer-not-required.exception';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { PrepareStrategy } from './base/prepare.strategy';

@Injectable()
export class DeFiChainStrategy extends PrepareStrategy {
  private readonly logger = new DfxLogger(DeFiChainStrategy);

  blockchain = Blockchain.DEFICHAIN;

  constructor(
    private readonly assetService: AssetService,
    private readonly dexService: DexService,
    private readonly defichainService: PayoutDeFiChainService,
    private readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super();
  }

  async preparePayout(orders: PayoutOrder[]): Promise<void> {
    const groups = Util.groupBy<PayoutOrder, PayoutOrderContext>(orders, 'context');

    for (const [context, group] of groups.entries()) {
      if (!(await this.defichainService.isHealthy(context))) continue;

      await this.preparePayoutForContext(context, group);
    }
  }

  async checkPreparationCompletion(orders: PayoutOrder[]): Promise<void> {
    const groups = Util.groupBy<PayoutOrder, PayoutOrderContext>(orders, 'context');

    for (const [context, group] of groups.entries()) {
      if (!(await this.defichainService.isHealthy(context))) continue;

      await this.checkPreparationCompletionForContext(context, group);
    }
  }

  async estimateFee(): Promise<FeeResult> {
    return { asset: await this.feeAsset(), amount: 0 };
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }

  //*** HELPER METHODS ***//

  private async preparePayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const groups = Util.groupByAccessor<PayoutOrder, number>(orders, (o) => o.asset.id);

    for (const [assetId, group] of groups.entries()) {
      try {
        await this.preparePayoutForAsset(context, group);
      } catch (e) {
        this.logger.error(
          `Error while preparing new payout orders for context ${context} and assetId ${assetId}: ${group.map(
            (o) => o.id,
          )}:`,
          e,
        );
        continue;
      }
    }
  }

  private async checkPreparationCompletionForContext(
    context: PayoutOrderContext,
    orders: PayoutOrder[],
  ): Promise<void> {
    const groups = Util.groupBy<PayoutOrder, string>(orders, 'transferTxId');

    for (const [transferTxId, group] of groups.entries()) {
      try {
        await this.checkPreparationCompletionForTx(context, group, transferTxId);
      } catch (e) {
        this.logger.error(
          `Error while checking preparation status of payout orders for context ${context} and transferTxId ${transferTxId}: ${group.map(
            (o) => o.id,
          )}:`,
          e,
        );
        continue;
      }
    }
  }

  private async preparePayoutForAsset(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const { amount, asset } = this.getTransferRequestData(orders);

    const destinationAddress = this.defichainService.getWalletAddress(context);
    const request = { asset, amount, destinationAddress };

    try {
      const transferTxId = await this.dexService.transferLiquidity(request);
      await this.recordPendingPreparation(orders, transferTxId);
    } catch (e) {
      if (e instanceof TransferNotRequiredException) {
        await this.autoCompletePreparation(orders);
        return;
      }

      throw e;
    }
  }

  private async checkPreparationCompletionForTx(
    _: PayoutOrderContext,
    orders: PayoutOrder[],
    transferTxId: string,
  ): Promise<void> {
    const isTransferComplete = await this.dexService.checkTransferCompletion(transferTxId, Blockchain.DEFICHAIN);

    if (isTransferComplete) {
      for (const order of orders) {
        order.preparationConfirmed();
        order.recordPreparationFee(await this.feeAsset(), 0);

        await this.payoutOrderRepo.save(order);
      }
    }
  }

  private async recordPendingPreparation(orders: PayoutOrder[], transferTxId: string): Promise<void> {
    for (const order of orders) {
      order.pendingPreparation(transferTxId);

      await this.payoutOrderRepo.save(order);
    }
  }

  private async autoCompletePreparation(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      order.preparationConfirmed();

      await this.payoutOrderRepo.save(order);
    }
  }

  private getTransferRequestData(orders: PayoutOrder[]): { asset: Asset; amount: number } {
    if (!orders.every((o) => o.asset.id === orders[0].asset.id)) {
      throw new Error('Cannot proceed with payout orders preparation, group contains orders of different assets');
    }

    if (!orders.every((o) => o.status === orders[0].status)) {
      throw new Error('Cannot proceed with payout orders preparation, group contains orders of different statuses');
    }

    if (!orders.every((o) => o.context === orders[0].context)) {
      throw new Error('Cannot proceed with payout orders preparation, group contains orders of different contexts');
    }

    return {
      asset: orders[0].asset,
      amount: Util.round(Util.sumObj(orders, 'amount'), 8),
    };
  }
}
