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
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';

@Injectable()
export class BuyCryptoOutService {
  private outClient: NodeClient;
  private dexClient: NodeClient;

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    private readonly buyCryptoChainUtil: BuyCryptoChainUtil,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
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
    try {
      const batches = await this.buyCryptoBatchRepo.find({
        where: {
          status: BuyCryptoBatchStatus.SECURED,
          outTxId: Not(IsNull()),
        },
        relations: ['transactions', 'transactions.buy', 'transactions.buy.user'],
      });

      if (batches.length === 0) {
        return;
      }

      const recentChainHistory = await this.buyCryptoChainUtil.getRecentChainHistory();
      const outAssets = await this.getAssetsOnOutNode();

      for (const batch of batches) {
        try {
          await this.checkPreviousPayouts(batch, recentChainHistory);
        } catch (e) {
          console.error(`Error on checking pervious payout for a batch ID: ${batch.id}`, e);
          continue;
        }

        if (batch.status === BuyCryptoBatchStatus.COMPLETE) {
          return;
        }

        const isValid = await this.validateNewPayouts(batch, outAssets);

        if (!isValid) {
          continue;
        }

        const groups = this.groupPayoutTransactions(batch);

        for (const group of groups) {
          // filtering out transactions that were already sent!
          const transactions = this.validateTransactions(group, recentChainHistory);

          // not to attempt sending empty batches for payout
          if (transactions.length === 0) {
            continue;
          }

          console.info(
            `Paying out ${transactions.length} transaction(s). Transaction ID(s): ${transactions.map((t) => t.id)}`,
          );

          batch.outputAsset === 'DFI'
            ? await this.sendDFI(transactions)
            : await this.sendToken(transactions, batch.outputAsset);
        }
      }
    } catch (e) {
      console.error(e);
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

    if (!isMatch) {
      const mismatch = amountOnOutNode ? batch.outputAmount - amountOnOutNode.amount : batch.outputAmount;
      const errorMessage = `Mismatch between batch and OUT amounts: ${mismatch}, cannot proceed with the batch ID: ${batch.id}`;

      console.error(errorMessage);
      this.buyCryptoNotificationService.sendNonRecoverableErrorMail(errorMessage);
    }

    return isMatch;
  }

  private groupPayoutTransactions(batch: BuyCryptoBatch): BuyCrypto[][] {
    console.info(`Grouping transactions for payout. Batch ID: ${batch.id}`);

    const groupSize = batch.outputAsset === 'DFI' ? 100 : 10;
    const numberOfGroups = Math.ceil(batch.transactions.length / groupSize);
    const result: BuyCrypto[][] = [];

    for (let i = 0; i <= numberOfGroups; i += groupSize) {
      result.push(batch.transactions.slice(i, i + groupSize));
    }

    return result;
  }

  private validateTransactions(
    group: BuyCrypto[],
    recentChainHistory: { txId: string; blockHeight: number }[],
  ): BuyCrypto[] {
    const validatedTransactions = group.filter((tx) => {
      const inChain = recentChainHistory.find((chainTx) => chainTx.txId === tx.txId);
      return !(tx.txId || inChain);
    });

    if (validatedTransactions.length !== group.length) {
      console.warn(`Dropped ${group.length - validatedTransactions.length} transactions to avoid double payout`);
    }

    return validatedTransactions;
  }

  private async sendToken(transactions: BuyCrypto[], outputAsset: string): Promise<void> {
    let txId: string;

    try {
      for (const tx of transactions) {
        await this.checkUtxo(tx.buy.user.address);
      }

      const payload = transactions.map((tx) => ({ addressTo: tx.buy.user.address, amount: tx.outputAmount }));

      txId = await this.outClient.sendTokenToMany(Config.node.outWalletAddress, outputAsset, payload);
    } catch (e) {
      console.error(`Error on sending ${outputAsset} for output. Transaction IDs: ${transactions.map((t) => t.id)}`, e);
    }

    for (const tx of transactions) {
      try {
        const paidTransaction = tx.recordTransactionPayout(txId);
        await this.buyCryptoRepo.save(paidTransaction);
      } catch (e) {
        const errorMessage = `Error on saving payout txId to the database. Transaction ID: ${tx.id}. Payout ID: ${txId}`;

        console.error(errorMessage, e);
        this.buyCryptoNotificationService.sendNonRecoverableErrorMail(errorMessage, e);
      }
    }
  }

  private async sendDFI(transactions: BuyCrypto[]): Promise<void> {
    let txId: string;

    try {
      const payload = transactions.map((tx) => ({ addressTo: tx.buy.user.address, amount: tx.outputAmount }));

      txId = await this.outClient.sendDFIToMany(payload);
    } catch (e) {
      console.error(`Error on sending DFI for output. Transaction IDs: ${transactions.map((t) => t.id)}`, e);
    }

    for (const tx of transactions) {
      try {
        const paidTransaction = tx.recordTransactionPayout(txId);
        await this.buyCryptoRepo.save(paidTransaction);
      } catch (e) {
        const errorMessage = `Error on saving payout txId to the database. Transaction ID: ${tx.id}. Payout ID: ${txId}`;

        console.error(errorMessage, e);
        this.buyCryptoNotificationService.sendNonRecoverableErrorMail(errorMessage, e);
      }
    }
  }

  private async checkUtxo(address: string): Promise<void> {
    const utxo = await this.whaleService.getClient().getBalance(address);

    if (!utxo) {
      await this.dexClient.sendToken(Config.node.dexWalletAddress, address, 'DFI', Config.node.minDfiDeposit / 2);
    }
  }
}
