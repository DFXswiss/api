import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { Config } from 'src/config/config';

@Injectable()
export class BuyCryptoChainUtil {
  async getHistoryEntryForTx(
    txId: string,
    client: DeFiClient,
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
