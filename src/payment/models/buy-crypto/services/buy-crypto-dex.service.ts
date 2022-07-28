import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { IsNull } from 'typeorm';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoBatchStatus, BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityOrderContext } from '../../dex/entities/liquidity-order.entity';
import { DexService, LiquidityRequest } from '../../dex/services/dex.service';
import { LiquidityOrderNotReadyException } from '../../dex/exceptions/liquidity-order-not-ready.exception';
import { PriceSlippageException } from '../../dex/exceptions/price-slippage.exception';
import { NotEnoughLiquidityException } from '../../dex/exceptions/not-enough-liquidity.exception';

@Injectable()
export class BuyCryptoDexService {
  private dexClient: DeFiClient;

  constructor(
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly assetService: AssetService,
    private readonly dexService: DexService,
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

      await this.checkPendingBatches(pendingBatches);
      await this.processNewBatches(newBatches);
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

  private async checkPendingBatches(pendingBatches: BuyCryptoBatch[]): Promise<void> {
    for (const batch of pendingBatches) {
      try {
        const liquidity = await this.dexService.fetchTargetLiquidityAfterPurchase(
          LiquidityOrderContext.BUY_CRYPTO,
          batch.id.toString(),
        );

        batch.secure(liquidity);
        await this.buyCryptoBatchRepo.save(batch);

        console.info(`Secured liquidity for batch. Batch ID: ${batch.id}`);
      } catch (e) {
        if (e instanceof LiquidityOrderNotReadyException) {
          continue;
        }

        console.error(`Failed to check pending batch. Batch ID: ${batch.id}`, e);
      }
    }
  }

  private async processNewBatches(newBatches: BuyCryptoBatch[]): Promise<void> {
    for (const batch of newBatches) {
      try {
        const liquidity = await this.checkLiquidity(batch);

        if (liquidity !== 0) {
          batch.secure(liquidity);
          await this.buyCryptoBatchRepo.save(batch);

          console.info(`Secured liquidity for batch. Batch ID: ${batch.id}.`);

          continue;
        }

        await this.purchaseLiquidity(batch);
      } catch (e) {
        console.info(`Error in processing new batch. Batch ID: ${batch.id}.`, e.message);
      }
    }
  }

  private async checkLiquidity(batch: BuyCryptoBatch): Promise<number> {
    try {
      const request = await this.createLiquidityRequest(batch);

      return await this.dexService.reserveLiquidity(request);
    } catch (e) {
      if (e instanceof NotEnoughLiquidityException) {
        console.info(e.message);
        return 0;
      }

      if (e instanceof PriceSlippageException) {
        await this.handleSlippageException(
          `Slippage error while checking liquidity for asset '${batch.outputAsset}. Batch ID: ${batch.id}`,
          e,
        );
      }

      throw new Error(`Error in checking liquidity for a batch, ID: ${batch.id}. ${e.message}`);
    }
  }

  private async purchaseLiquidity(batch: BuyCryptoBatch) {
    let txId: string;

    try {
      const request = await this.createLiquidityRequest(batch);
      await this.dexService.purchaseLiquidity(request);

      batch.pending();
    } catch (e) {
      if (e instanceof PriceSlippageException) {
        await this.handleSlippageException(
          `Composite swap slippage error while purchasing asset '${batch.outputAsset}. Batch ID: ${batch.id}`,
          e,
        );
      }

      throw new Error(
        `Error in purchasing liquidity of asset '${batch.outputAsset}'. Batch ID: ${batch.id}. ${e.message}`,
      );
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

  private async createLiquidityRequest(batch: BuyCryptoBatch): Promise<LiquidityRequest> {
    const targetAsset = await this.assetService.getAssetByDexName(batch.outputAsset);

    return {
      context: LiquidityOrderContext.BUY_CRYPTO,
      correlationId: batch.id.toString(),
      referenceAsset: batch.outputReferenceAsset,
      referenceAmount: batch.outputReferenceAmount,
      targetAsset,
    };
  }

  private async handleSlippageException(message: string, e: Error): Promise<void> {
    await this.buyCryptoNotificationService.sendNonRecoverableErrorMail(message, e);
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
