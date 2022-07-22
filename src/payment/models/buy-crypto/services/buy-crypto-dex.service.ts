import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { IsNull } from 'typeorm';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoBatchStatus, BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { DeFiChainUtil } from '../../dex/utils/defichain.util';
import { Util } from 'src/shared/util';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityOrderContext } from '../../dex/entities/liquidity-order.entity';
import {
  PurchaseLiquidityFacade,
  PurchaseLiquidityRequest,
} from '../../dex/strategies/purchase-liquidity/purchase-liquidity.facade';

@Injectable()
export class BuyCryptoDexService {
  private dexClient: DeFiClient;

  constructor(
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoChainUtil: DeFiChainUtil,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly assetService: AssetService,
    private readonly purchaseLiquidityFacade: PurchaseLiquidityFacade,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async secureLiquidity(): Promise<void> {
    try {
      const newBatches = await this.buyCryptoBatchRepo.find({
        where: { status: BuyCryptoBatchStatus.CREATED },
        relations: ['transactions'],
      });

      const pendingBatches = await this.buyCryptoBatchRepo.find({
        where: { status: BuyCryptoBatchStatus.PENDING_LIQUIDITY },
        relations: ['transactions'],
      });

      await this.secureLiquidityPerBatch(newBatches, pendingBatches);
    } catch (e) {
      console.error(e);
    }
  }

  async transferLiquidityForOutput(): Promise<void> {
    try {
      const batches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.SECURED, outTxId: IsNull() });

      batches?.length &&
        console.info(`Transferring ${batches.length} batch(es) to OUT Node. Batch ID(s): ${batches.map((b) => b.id)}`);

      for (const batch of batches) {
        await this.transferForOutput(batch);
      }
    } catch (e) {
      console.error(e);
    }
  }

  private async secureLiquidityPerBatch(newBatches: BuyCryptoBatch[], pendingBatches: BuyCryptoBatch[]): Promise<void> {
    await this.checkPendingBatches(pendingBatches);
    await this.processNewBatches(newBatches);
  }

  private async checkPendingBatches(pendingBatches: BuyCryptoBatch[]): Promise<void> {
    for (const batch of pendingBatches) {
      try {
        const { blockhash, confirmations } = await this.dexClient.getTx(batch.purchaseTxId);

        if (blockhash && confirmations > 0) {
          const liquidity = await this.getLiquidityAfterPurchase(batch);
          batch.secure(liquidity);
          await this.buyCryptoBatchRepo.save(batch);

          console.info(`Secured liquidity for batch. Batch ID: ${batch.id}`);
        }
      } catch (e) {
        console.error(`Failed to check pending batch. Batch ID: ${batch.id}`, e);
      }
    }
  }

  private async getLiquidityAfterPurchase(batch: BuyCryptoBatch): Promise<number> {
    const { purchaseTxId, outputAsset, outputReferenceAsset, outputReferenceAmount } = batch;

    if (outputReferenceAsset === outputAsset) {
      return outputReferenceAmount;
    }

    const historyEntry = await this.buyCryptoChainUtil.getHistoryEntryForTx(batch.purchaseTxId, this.dexClient);

    if (!historyEntry) {
      throw new Error(
        `Could not find transaction with ID: ${purchaseTxId} while trying to extract purchased liquidity`,
      );
    }

    const amounts = historyEntry.amounts.map((a) => this.dexClient.parseAmount(a));

    const { amount } = amounts.find((a) => a.asset === outputAsset);

    if (!amount) {
      throw new Error(`Failed to get amount for TX: ${purchaseTxId} while trying to extract purchased liquidity`);
    }

    return amount;
  }

  private async processNewBatches(newBatches: BuyCryptoBatch[]): Promise<void> {
    for (const batch of newBatches) {
      try {
        const liquidity = await this.checkLiquidity(batch);

        if (liquidity !== 0) {
          batch.secure(liquidity);
          await this.buyCryptoBatchRepo.save(batch);

          console.info(`Secured liquidity for batch. Batch ID: ${batch.id}`);

          continue;
        }

        await this.purchaseLiquidity(batch);
      } catch (e) {
        console.info(`Error in processing new batch. Batch ID: ${batch.id}`, e);
      }
    }
  }

  private async checkLiquidity(batch: BuyCryptoBatch): Promise<number> {
    try {
      const requiredAmount = await this.dexClient.testCompositeSwap(
        batch.outputReferenceAsset,
        batch.outputAsset,
        batch.outputReferenceAmount,
      );

      const availableAmount = await this.buyCryptoChainUtil.getAvailableTokenAmount(batch.outputAsset, this.dexClient);

      if (availableAmount >= requiredAmount) {
        const targetAmount = requiredAmount;

        const basePrice =
          1 /
          ((await this.dexClient.testCompositeSwap(
            batch.outputReferenceAsset,
            batch.outputAsset,
            batch.minimalOutputReferenceAmount,
          )) /
            batch.minimalOutputReferenceAmount);

        const maxPrice = Util.round(basePrice + basePrice * batch.maxPriceSlippage, 8);
        const minimalAllowedTargetAmount = Util.round(batch.outputReferenceAmount / maxPrice, 8);

        if (targetAmount < minimalAllowedTargetAmount) {
          throw new Error(
            `Price is higher than indicated. Maximum price for asset ${batch.outputAsset} is ${maxPrice} ${batch.outputReferenceAsset}`,
          );
        }

        return targetAmount;
      }

      return 0;
    } catch (e) {
      if (this.isSlippageError(e))
        this.handleSlippageError(
          `Slippage error while checking liquidity for asset '${batch.outputAsset}. Batch ID: ${batch.id}`,
          e,
        );

      console.error(`Error in checking liquidity for a batch, ID: ${batch.id}`, e);
      throw e;
    }
  }

  private async purchaseLiquidity(batch: BuyCryptoBatch) {
    let txId: string;

    try {
      const targetAsset = await this.assetService.getAssetByDexName(batch.outputAsset);
      const request: PurchaseLiquidityRequest = {
        context: LiquidityOrderContext.BUY_CRYPTO,
        correlationId: batch.id.toString(),
        referenceAsset: batch.outputReferenceAsset,
        referenceAmount: batch.outputReferenceAmount,
        targetAsset,
      };

      await this.purchaseLiquidityFacade.purchaseLiquidity(request);

      batch.pending();
    } catch (e) {
      if (this.isSlippageError(e))
        return this.handleSlippageError(
          `Composite swap slippage error while purchasing asset '${batch.outputAsset}. Batch ID: ${batch.id}`,
          e,
        );

      console.error(`Error in purchasing liquidity of asset '${batch.outputAsset}'. Batch ID: ${batch.id}`, e);
      return;
    }

    try {
      await this.buyCryptoBatchRepo.save(batch);
    } catch (e) {
      console.error(
        `Error in saving PENDING status after purchasing '${batch.outputAsset}'. Batch ID: ${batch.id}. Purchase ID: ${txId}`,
        e,
      );
      throw e;
    }
  }

  private isSlippageError(e: Error): boolean {
    return e.message && e.message.includes('Price is higher than indicated');
  }

  private handleSlippageError(message: string, e: Error): void {
    this.buyCryptoNotificationService.sendNonRecoverableErrorMail(message, e);
  }

  private async transferForOutput(batch: BuyCryptoBatch): Promise<void> {
    let txId: string;

    try {
      txId = await this.dexClient.sendToken(
        Config.node.dexWalletAddress,
        Config.node.outWalletAddress,
        batch.outputAsset,
        batch.outputAmount,
      );

      batch.recordDexToOutTransfer(txId);
    } catch (e) {
      console.error(`Error in transferring to OUT. Asset '${batch.outputAsset}'. Batch ID: ${batch.id}`, e);
      return;
    }

    try {
      await this.buyCryptoBatchRepo.save(batch);
    } catch (e) {
      console.error(
        `Error in saving DEX to OUT transaction. Asset '${batch.outputAsset}'. Batch ID: ${batch.id}. Transfer ID: ${txId} `,
        e,
      );
    }
  }
}
