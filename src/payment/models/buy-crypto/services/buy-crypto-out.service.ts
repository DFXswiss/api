import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { WhaleService } from 'src/ain/whale/whale.service';
import { Config } from 'src/config/config';
import { Not, IsNull } from 'typeorm';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoBatchStatus, BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoChainUtil } from '../utils/buy-crypto-chain.util';

@Injectable()
export class BuyCryptoOutService {
  private outClient: NodeClient;
  private dexClient: NodeClient;

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoChainUtil: BuyCryptoChainUtil,
    private readonly whaleService: WhaleService,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.outClient = client));
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async getAssetsOnOutNode(): Promise<{ amount: number; asset: string }[]> {
    const tokens = await this.outClient.getToken();

    return tokens.map((t) => this.outClient.parseAmount(t.amount));
  }

  async payoutTransactions(): Promise<void> {
    const batches = await this.buyCryptoBatchRepo.find({
      where: {
        status: BuyCryptoBatchStatus.SECURED,
        outTxId: Not(IsNull()),
      },
      relations: ['transactions'],
    });

    const recentChainHistory = await this.buyCryptoChainUtil.getRecentChainHistory();
    const outAssets = await this.getAssetsOnOutNode();

    for (const batch of batches) {
      try {
        await this.checkPreviousPayouts(batch, recentChainHistory);
      } catch (e) {
        // log the error and continue with next batch
        console.error(`Error on checking pervious payout for a batch ID: ${batch.id}`, e);
      }

      if (batch.status === BuyCryptoBatchStatus.COMPLETE) {
        return;
      }

      const isValid = await this.validateNewPayouts(batch, outAssets);

      if (!isValid) {
        break;
      }

      const groups = this.groupPayoutTransactions(batch);

      for (const group of groups) {
        // maybe overkill
        const transactions = this.validateTransactions(group, recentChainHistory);

        batch.outputAsset === 'DFI'
          ? await this.sendDFI(transactions)
          : await this.sendToken(transactions, batch.outputAsset);
      }
    }
  }

  private async checkPreviousPayouts(
    batch: BuyCryptoBatch,
    recentChainHistory: { txId: string; blockHeight: number }[],
  ): Promise<void> {
    const isComplete = batch.transactions.every(({ txId }) => {
      const inChain = recentChainHistory.find((tx) => tx.txId === txId);
      return !!(txId && inChain);
    });

    if (isComplete) {
      // no write to blockchain, if write is failed, just start over
      batch.recordBlockHeight(recentChainHistory);
      batch.complete();

      await this.buyCryptoBatchRepo.save(batch);
    }
  }

  private async validateNewPayouts(
    batch: BuyCryptoBatch,
    outAssets: { amount: number; asset: string }[],
  ): Promise<boolean> {
    const amountOnOutNode = outAssets.find((a) => a.asset === batch.outputAsset);
    const isMatch = amountOnOutNode && amountOnOutNode.amount === batch.outputAmount;

    if (!isMatch && amountOnOutNode) {
      const mismatch = amountOnOutNode.amount - batch.outputAmount;
      console.error(`Mismatch between batch and OUT amounts: ${mismatch}, cannot proceed with the batch`);
    }

    return isMatch;
  }

  private groupPayoutTransactions(batch: BuyCryptoBatch): BuyCrypto[][] {
    const groupSize = batch.outputAsset === 'DFI' ? 100 : 10;
    const numberOfGroups = Math.ceil(batch.transactions.length / groupSize);
    const result: BuyCrypto[][] = [];

    for (let i = 0; i <= numberOfGroups; i += groupSize) {
      result.push(batch.transactions.slice(i, i + groupSize));
    }

    return result;
  }

  // maybe overkill
  private validateTransactions(
    group: BuyCrypto[],
    recentChainHistory: { txId: string; blockHeight: number }[],
  ): BuyCrypto[] {
    return group.filter((tx) => {
      const inChain = recentChainHistory.find((chainTx) => chainTx.txId === tx.txId);
      !(tx.txId || inChain);
    });
  }

  private async sendToken(transactions: BuyCrypto[], outputAsset: string): Promise<void> {
    for (const tx of transactions) {
      // need to wait for tx completion?
      await this.checkUtxo(tx.buy.user.wallet.address);
    }

    const payload = transactions.map((tx) => ({ addressTo: tx.buy.user.wallet.address, amount: tx.outputAmount }));

    const txId = await this.outClient.sendTokenToMany(Config.node.outWalletAddress, outputAsset, payload);

    for (const tx of transactions) {
      // in case this break, see the OUT node, there is nowhere to get txId from
      await this.buyCryptoRepo.update({ id: tx.id }, { txId });
    }
  }

  private async sendDFI(transactions: BuyCrypto[]): Promise<void> {
    const payload = transactions.map((tx) => ({ addressTo: tx.buy.user.wallet.address, amount: tx.outputAmount }));

    const txId = await this.outClient.sendDFIToMany(payload);

    for (const tx of transactions) {
      await this.buyCryptoRepo.update({ id: tx.id }, { txId });
    }
  }

  private async checkUtxo(address: string): Promise<void> {
    const utxo = await this.whaleService.getClient().getBalance(address);

    if (!utxo) {
      await this.dexClient.sendToken(Config.node.dexWalletAddress, address, 'DFI', Config.node.minDfiDeposit / 2);
    }
  }
}
