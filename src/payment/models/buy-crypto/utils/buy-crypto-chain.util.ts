import { Transaction } from '@defichain/whale-api-client/dist/api/transactions';
import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { WhaleClient } from 'src/ain/whale/whale-client';
import { Config } from 'src/config/config';
import { BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';

@Injectable()
export class BuyCryptoChainUtil {
  private dexClient: NodeClient;

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async getRecentChainHistory(): Promise<{ txId: string; blockHeight: number; amounts: string[] }[]> {
    const { blocks: currentHeight } = await this.dexClient.getInfo();
    const lastHeight = await this.buyCryptoRepo
      .findOne({ order: { blockHeight: 'DESC' } })
      .then((tx) => tx?.blockHeight ?? 0);

    console.info(`Getting chain history from block ${lastHeight} to block ${currentHeight}`);

    return await this.dexClient
      .getHistories([Config.node.dexWalletAddress, Config.node.outWalletAddress], lastHeight - 100, currentHeight)
      .then((h) => h.map((h) => ({ txId: h.txid, blockHeight: h.blockHeight, amounts: h.amounts })));
  }

  async checkCompletion(batch: BuyCryptoBatch, client: WhaleClient) {
    const uniqueTransactions = new Map<string, Transaction>();

    for (const tx of batch.transactions) {
      if (!tx.txId || (tx.txId && tx.isComplete)) {
        continue;
      }

      try {
        const transaction = uniqueTransactions.get(tx.txId) || (await client.getTx(tx.txId));

        if (transaction) {
          uniqueTransactions.set(tx.txId, transaction);

          const { height: blockHeight } = transaction?.block;

          if (blockHeight) {
            tx.complete(blockHeight);
            await this.buyCryptoRepo.save(tx);
          }
        }
      } catch {
        console.error(`Error on validating transaction completion. ID: ${tx.id}. Chain txId: ${tx.txId}`);
        continue;
      }
    }

    const isBatchComplete = batch.transactions.every((tx) => tx.txId && tx.isComplete);

    if (isBatchComplete) {
      batch.complete();
      this.buyCryptoBatchRepo.save(batch);
    }
  }
}
