import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { Config } from 'src/config/config';

@Injectable()
export class DeFiChainUtil {
  async getHistoryEntryForTx(
    txId: string,
    client: DeFiClient,
  ): Promise<{ txId: string; blockHeight: number; amounts: string[] }> {
    const transaction = await client.getTx(txId);

    if (transaction && transaction.blockhash && transaction.confirmations > 0) {
      const { height } = await client.getBlock(transaction.blockhash);

      return client
        .getHistories([Config.blockchain.default.dexWalletAddress], height, height + 1)
        .then((histories) =>
          histories
            .map((h) => ({ txId: h.txid, blockHeight: h.blockHeight, amounts: h.amounts }))
            .find((t) => t.txId === txId),
        );
    }
  }

  async getAvailableTokenAmount(assetName: string, client: DeFiClient): Promise<number> {
    const tokens = await client.getToken();
    // TODO -> filter by address DEX_WALLET_ADDRESS
    const token = tokens.map((t) => client.parseAmount(t.amount)).find((pt) => pt.asset === assetName);

    return token ? token.amount : 0;
  }
}
