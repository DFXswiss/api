import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';

@Injectable()
export class DeFiChainUtil {
  async getHistoryEntryForTx(
    txId: string,
    client: DeFiClient,
  ): Promise<{ txId: string; blockHeight: number; amounts: string[]; fee: number } | null> {
    const transaction = await client.getTx(txId);

    if (transaction && transaction.blockhash && transaction.confirmations > 0) {
      const { height } = await client.getBlock(transaction.blockhash);

      return client
        .getHistory(height, height + 1, Config.blockchain.default.dex.address)
        .then((histories) =>
          histories
            .map((h) => ({ txId: h.txid, blockHeight: h.blockHeight, amounts: h.amounts, fee: transaction.fee }))
            .find((t) => t.txId === txId),
        );
    }

    return null;
  }

  async getAvailableTokenAmount(assetName: string, client: DeFiClient): Promise<number> {
    const tokens = await client.getToken();
    const token = tokens
      .filter((t) => t.owner === Config.blockchain.default.dex.address)
      .map((t) => client.parseAmount(t.amount))
      .find((pt) => pt.asset === assetName);

    return token ? token.amount : 0;
  }
}
