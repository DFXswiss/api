import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { IsNull } from 'typeorm';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoBatchStatus, BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCryptoChainUtil } from '../utils/buy-crypto-chain.util';
import { Util } from 'src/shared/util';

@Injectable()
export class BuyCryptoDexService {
  private dexClient: NodeClient;

  constructor(
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoChainUtil: BuyCryptoChainUtil,
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

      const securedBatches = await this.buyCryptoBatchRepo.find({
        where: { status: BuyCryptoBatchStatus.SECURED },
        relations: ['transactions'],
      });

      const pendingBatches = await this.buyCryptoBatchRepo.find({
        where: { status: BuyCryptoBatchStatus.PENDING_LIQUIDITY },
        relations: ['transactions'],
      });

      await this.secureLiquidityPerBatch(newBatches, securedBatches, pendingBatches);
    } catch (e) {
      console.error(e);
    }
  }

  async transferLiquidityForOutput(): Promise<void> {
    try {
      const batches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.SECURED, outTxId: IsNull() });

      batches?.length && console.info(`Transferring ${batches.length} batch(es) to OUT Node`);

      for (const batch of batches) {
        this.transferForOutput(batch);
      }
    } catch (e) {
      console.error(e);
    }
  }

  private async secureLiquidityPerBatch(
    newBatches: BuyCryptoBatch[],
    securedBatches: BuyCryptoBatch[],
    pendingBatches: BuyCryptoBatch[],
  ): Promise<void> {
    await this.checkPendingBatches(pendingBatches);
    await this.processNewBatches(newBatches, securedBatches, pendingBatches);
  }

  private async checkPendingBatches(pendingBatches: BuyCryptoBatch[]): Promise<void> {
    for (const batch of pendingBatches) {
      try {
        const { blockhash, confirmations } = await this.dexClient.getTx(batch.purchaseTxId);

        if (blockhash && confirmations > 0) {
          const liquidity = await this.getLiquidityAfterPurchase(batch);
          batch.secure(liquidity);
          await this.buyCryptoBatchRepo.save(batch);
        }
      } catch (e) {
        console.error(`Failed to check pending batch, ID: ${batch.id}`, e);
      }
    }
  }

  private async getLiquidityAfterPurchase(batch: BuyCryptoBatch): Promise<number> {
    const { purchaseTxId, outputAsset, outputReferenceAsset, outputReferenceAmount } = batch;

    if (outputReferenceAsset === outputAsset) {
      return outputReferenceAmount;
    }

    const history = await this.buyCryptoChainUtil.getRecentChainHistory();
    const transaction = history.find((tx) => tx.txId === purchaseTxId);

    if (!transaction) {
      throw new Error(
        `Could not find transaction with ID: ${purchaseTxId} while trying to extract purchased liquidity`,
      );
    }

    const amounts = transaction.amounts.map((a) => this.dexClient.parseAmount(a));

    const { amount } = amounts.find((a) => a.asset === outputAsset);

    if (!amount) {
      throw new Error(`Failed to get amount for TX: ${purchaseTxId} while trying to extract purchased liquidity`);
    }

    return amount;
  }

  private async processNewBatches(
    newBatches: BuyCryptoBatch[],
    securedBatches: BuyCryptoBatch[],
    pendingBatches: BuyCryptoBatch[],
  ): Promise<void> {
    for (const batch of newBatches) {
      try {
        const liquidity = await this.checkLiquidity(batch, securedBatches, pendingBatches);

        if (liquidity !== 0) {
          batch.secure(liquidity);
          await this.buyCryptoBatchRepo.save(batch);

          return;
        }

        await this.purchaseLiquidity(batch);
      } catch {
        console.info(`Error in processing new batch, ID: ${batch.id}`);
      }
    }
  }

  private async checkLiquidity(
    batch: BuyCryptoBatch,
    securedBatches: BuyCryptoBatch[],
    pendingBatches: BuyCryptoBatch[],
  ): Promise<number> {
    const securedAmount = securedBatches
      .filter((securedBatch) => securedBatch.outputAsset === batch.outputAsset)
      .reduce((acc, curr) => acc + curr.outputReferenceAmount, 0);

    const pendingAmount = pendingBatches
      .filter((pendingBatch) => pendingBatch.outputAsset === batch.outputAsset)
      .reduce((acc, curr) => acc + curr.outputReferenceAmount, 0);

    try {
      const requiredAmount = await this.dexClient.testCompositeSwap(
        batch.outputReferenceAsset,
        batch.outputAsset,
        batch.outputReferenceAmount + securedAmount + pendingAmount,
      );

      const availableAmount = await this.getAvailableTokenAmount(batch);

      return availableAmount >= requiredAmount ? requiredAmount : 0;
    } catch (e) {
      console.error(`Error in checking liquidity for a batch, ID: ${batch.id}`, e);
      throw e;
    }
  }

  private async getAvailableTokenAmount(batch: BuyCryptoBatch): Promise<number> {
    const tokens = await this.dexClient.getToken();
    const token = tokens.map((t) => this.dexClient.parseAmount(t.amount)).find((pt) => pt.asset === batch.outputAsset);

    return token ? token.amount : 0;
  }

  private async purchaseLiquidity(batch: BuyCryptoBatch) {
    let txId: string;

    try {
      const DFIAmount =
        (await this.dexClient.testCompositeSwap(batch.outputReferenceAsset, 'DFI', 1)) * batch.outputReferenceAmount;

      txId = await this.dexClient.compositeSwap(
        Config.node.dexWalletAddress,
        'DFI',
        Config.node.dexWalletAddress,
        batch.outputAsset,
        // swapping a bit more output asset to cover commissions
        DFIAmount + Util.round(DFIAmount * 0.001, 8),
      );

      batch.pending(txId);
    } catch (e) {
      console.error(`Error in purchasing liquidity of asset '${batch.outputAsset}'. Batch ID: ${batch.id}`, e);
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
    }

    try {
      this.buyCryptoBatchRepo.save(batch);
    } catch (e) {
      console.error(
        `Error in saving DEX to OUT transaction. Asset '${batch.outputAsset}'. Batch ID: ${batch.id}. Transfer ID: ${txId} `,
        e,
      );
    }
  }
}
