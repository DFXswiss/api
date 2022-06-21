import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { BlockchainWriteError } from 'src/payment/exceptions/blockchain-write.exception';
import { DBWriteError } from 'src/payment/exceptions/db-write.exception';
import { IsNull } from 'typeorm';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoBatchStatus, BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCryptoChainUtil } from '../utils/buy-crypto-chain.util';

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
    const newBatches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.CREATED });
    const securedBatches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.SECURED });
    const pendingBatches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.PENDING_LIQUIDITY });

    await this.secureLiquidityPerBatch(newBatches, securedBatches, pendingBatches);
  }

  async transferLiquidityForOutput(): Promise<void> {
    const batches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.SECURED, outTxId: IsNull() });

    for (const batch of batches) {
      this.transferForOutput(batch);
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
        // get the output amount for purchase here -> getRecentChainHistory
        // for non-reference just take the amount
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

    const amounts = transaction.amounts.map((a) => this.dexClient.parseAmount(a));

    const { amount } = amounts.find((a) => a.asset === outputAsset);

    if (!amount) {
      // throw ???
    }

    return amount;
  }

  private async processNewBatches(
    newBatches: BuyCryptoBatch[],
    securedBatches: BuyCryptoBatch[],
    pendingBatches: BuyCryptoBatch[],
  ): Promise<void> {
    for (const batch of newBatches) {
      const liquidity = await this.checkLiquidity(batch, securedBatches, pendingBatches);

      if (liquidity !== 0) {
        batch.secure(liquidity);
        await this.buyCryptoBatchRepo.save(batch);

        return;
      }

      await this.purchaseLiquidity(batch);
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
      // this should just abort the batch processing, no specific handler
      console.error(`Error on checking liquidity for a batch, ID: ${batch.id}`, e);
      throw e;
    }
  }

  private async getAvailableTokenAmount(batch: BuyCryptoBatch): Promise<number> {
    const tokens = await this.dexClient.getToken();
    const token = tokens.map((t) => this.dexClient.parseAmount(t.amount)).find((pt) => pt.asset === batch.outputAsset);

    return token ? token.amount : 0;
  }

  private async purchaseLiquidity(batch: BuyCryptoBatch) {
    const DFIAmount =
      (await this.dexClient.testCompositeSwap(batch.outputReferenceAsset, 'DFI', 1)) * batch.outputReferenceAmount;

    // make a swap for a bit bigger amount if this is reference asset
    const txId = await this.dexClient.compositeSwap(
      Config.node.dexWalletAddress,
      'DFI',
      Config.node.dexWalletAddress,
      batch.outputAsset,
      DFIAmount,
    );

    batch.pending(txId);
  }

  private async transferForOutput(batch: BuyCryptoBatch): Promise<void> {
    let txId: string;

    // read from out and write to DB as a recovery.
    // DO this check so not to process twice. or do it manually

    try {
      // no need a wrapper, just use sendToken
      txId = await this.dexClient.sendToken(
        Config.node.dexWalletAddress,
        Config.node.outWalletAddress,
        batch.outputAsset,
        batch.outputAmount,
      );
    } catch (e) {
      // this also might be removed
      throw new BlockchainWriteError('Transfer from DEX to OUT', e);
    }

    try {
      batch.recordOutToDexTransfer(txId);
      this.buyCryptoBatchRepo.save(batch);
    } catch (e) {
      throw new DBWriteError('Saving txId to batch', e);
    }
  }
}
