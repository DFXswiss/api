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
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';

@Injectable()
export class BuyCryptoDexService {
  private dexClient: NodeClient;

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoChainUtil: BuyCryptoChainUtil,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async secureLiquidity(): Promise<void> {
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

    console.log('newBatches', newBatches);
    console.log('securedBatches', securedBatches);
    console.log('pendingBatches', pendingBatches);

    await this.secureLiquidityPerBatch(newBatches, securedBatches, pendingBatches);
  }

  async transferLiquidityForOutput(): Promise<void> {
    const batches = await this.buyCryptoBatchRepo.find({ status: BuyCryptoBatchStatus.SECURED, outTxId: IsNull() });

    console.log('Batches for output', batches);

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
    console.log('checkPendingBatches start');
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

      console.log('liquidity', liquidity);

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
    console.log('Checking liquidity', batch);
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

      console.log('Checking liquidity requiredAmount', requiredAmount);
      console.log('Checking liquidity availableAmount', availableAmount);

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
    console.log('Purchasing liquidity start');
    const DFIAmount =
      (await this.dexClient.testCompositeSwap(batch.outputReferenceAsset, 'DFI', 1)) * batch.outputReferenceAmount;

    console.log('DFIAmount', DFIAmount);
    // make a swap for a bit bigger amount if this is reference asset
    const txId = await this.dexClient.compositeSwap(
      Config.node.dexWalletAddress,
      'DFI',
      Config.node.dexWalletAddress,
      batch.outputAsset,
      DFIAmount,
    );

    batch.pending(txId);

    console.log('After marking pending', batch);
  }

  private async transferForOutput(batch: BuyCryptoBatch): Promise<void> {
    let txId: string;

    // read from out and write to DB as a recovery.
    // DO this check so not to process twice. or do it manually

    try {
      txId = await this.dexClient.sendToken(
        Config.node.dexWalletAddress,
        Config.node.outWalletAddress,
        batch.outputAsset,
        batch.outputAmount,
        [],
      );

      console.log('TXID after sending to OUT', txId);
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

  private async doTokenTx(addressFrom: string, tx: (utxo: UTXO) => Promise<string>): Promise<string> {
    const feeUtxo = await this.getFeeUtxo(addressFrom);
    return feeUtxo ? await this.tokenTx(addressFrom, tx, feeUtxo) : this.tokenTx(addressFrom, tx); // no waiting;
  }

  private async tokenTx(addressFrom: string, tx: (utxo: UTXO) => Promise<string>, feeUtxo?: UTXO): Promise<string> {
    try {
      // get UTXO
      if (!feeUtxo) {
        const utxoTx = await this.sendFeeUtxo(addressFrom);
        await this.dexClient.waitForTx(utxoTx);
        feeUtxo = await this.dexClient
          .getUtxo()
          .then((utxos) => utxos.find((u) => u.txid === utxoTx && u.address === addressFrom));
      }

      // do TX
      return await tx(feeUtxo);
    } catch (e) {
      console.error('Failed to do token TX:', e);
    }
  }

  private async sendToken2(addressFrom: string, addressTo: string, token: string, amount: number): Promise<string> {
    return await this.doTokenTx(addressFrom, async (utxo) => {
      const outTxId = await this.dexClient.sendToken(addressFrom, addressTo, token, amount, [utxo]);

      return outTxId;
    });
  }

  private async getFeeUtxo(address: string): Promise<UTXO | undefined> {
    return await this.dexClient
      .getUtxo()
      .then((utxos) =>
        utxos.find(
          (u) =>
            u.address === address &&
            u.amount.toNumber() < Config.node.minDfiDeposit &&
            u.amount.toNumber() > Config.node.minDfiDeposit / 4,
        ),
      );
  }

  private async sendFeeUtxo(address: string): Promise<string> {
    return await this.dexClient.sendUtxo(Config.node.utxoSpenderAddress, address, Config.node.minDfiDeposit / 2);
  }

  private async saveBatch(batch: BuyCryptoBatch): Promise<BuyCryptoBatch> {
    const updatedBatch = await this.buyCryptoBatchRepo.save(batch);
    for (const tx of batch.transactions) {
      await this.buyCryptoRepo.save(tx);
      // in case of interim DB failure - will safely start over
    }

    return updatedBatch;
  }
}
