import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { Config } from 'src/config/config';
import { BuyCryptoBatchRepository } from '../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';

@Injectable()
export class BuyCryptoChainUtil {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyCryptoBatchRepo: BuyCryptoBatchRepository,
  ) {}

  async getHistoryEntryForTx(
    txId: string,
    client: NodeClient,
  ): Promise<{ txId: string; blockHeight: number; amounts: string[] }> {
    const transaction = await client.getTx(txId);

    if (transaction && transaction.blockhash && transaction.confirmations > 0) {
      const { height } = await client.getBlock(transaction.blockhash);

      return client
        .getHistories([Config.node.dexWalletAddress], height, height + 1)
        .then((h) =>
          h.map((h) => ({ txId: h.txid, blockHeight: h.blockHeight, amounts: h.amounts })).find((t) => t.txId === txId),
        );
    }
  }
}
