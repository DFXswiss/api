import { InWalletTransaction } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
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

  async getHistoryEntryForTx(
    txId: string,
    client: NodeClient,
  ): Promise<{ txId: string; blockHeight: number; amounts: string[] }> {
    const transaction = await client.getTx(txId);

    if (transaction && transaction.blockhash && transaction.confirmations > 0) {
      const { height } = await client.getBlock(transaction.blockhash);
      const { blocks: currentHeight } = await this.dexClient.getInfo();

      return client
        .getHistories([Config.node.dexWalletAddress, Config.node.outWalletAddress], height, currentHeight)
        .then((h) =>
          h.map((h) => ({ txId: h.txid, blockHeight: h.blockHeight, amounts: h.amounts })).find((t) => t.txId === txId),
        );
    }
  }

  async checkCompletion(batch: BuyCryptoBatch, client: NodeClient) {
    const uniqueTransactions = new Map<string, InWalletTransaction>();

    for (const tx of batch.transactions) {
      if (!tx.txId || (tx.txId && tx.isComplete)) {
        continue;
      }

      try {
        const transaction = uniqueTransactions.get(tx.txId) || (await client.getTx(tx.txId));

        if (transaction && transaction.blockhash && transaction.confirmations > 0) {
          const block = await client.getBlock(transaction.blockhash);
          uniqueTransactions.set(tx.txId, transaction);

          if (block?.height) {
            tx.complete();
            await this.buyCryptoRepo.save(tx);
          }
        }
      } catch (e) {
        console.error(`Error on validating transaction completion. ID: ${tx.id}. Chain txId: ${tx.txId}`, e);
        continue;
      }
    }

    const isBatchComplete = batch.transactions.every((tx) => tx.txId && tx.isComplete);

    if (isBatchComplete) {
      console.info(`Buy crypto batch payout complete. Batch ID: ${batch.id}`);
      batch.complete();
      this.buyCryptoBatchRepo.save(batch);
    }
  }
}
