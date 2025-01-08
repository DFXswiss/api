import { Config } from 'src/config/config';
import { NodeClient, NodeCommand } from './node-client';

export interface TransactionHistory {
  address: string;
  category: string;
  blocktime: number;
  txid: string;
  confirmations: number;
  amount: number;
}

export class BtcClient extends NodeClient {
  async send(
    addressTo: string,
    txId: string,
    amount: number,
    vout: number,
    feeRate: number,
  ): Promise<{ outTxId: string; feeAmount: number }> {
    // 135 vByte for a single-input single-output TX
    const feeAmount = (feeRate * 135) / Math.pow(10, 8);

    const sendUtxo = await this.callNode<{ txid: string }>(
      (c) =>
        c.call(
          NodeCommand.SEND,
          [
            [{ [addressTo]: this.roundAmount(amount - feeAmount) }],
            null,
            'unset',
            null,
            { fee_rate: feeRate, inputs: [{ txid: txId, vout: vout }], replaceable: true },
          ],
          'number',
        ),
      true,
    );

    return { outTxId: sendUtxo.txid, feeAmount };
  }

  async sendMany(payload: { addressTo: string; amount: number }[], feeRate: number): Promise<string> {
    const batch = payload.reduce((acc, p) => ({ ...acc, [p.addressTo]: `${p.amount}` }), {});

    return this.callNode<{ txid: string }>(
      (c) =>
        c.call(
          NodeCommand.SEND,
          [
            batch,
            null,
            'unset',
            null,
            { fee_rate: feeRate, replaceable: true, change_address: Config.blockchain.default.btcOutput.address },
          ],
          'number',
        ),
      true,
    ).then((r) => r.txid);
  }

  async getRecentHistory(txCount = 100): Promise<TransactionHistory[]> {
    return this.callNode<TransactionHistory[]>((c) => c.call('listtransactions', ['*', txCount], 'number'), true);
  }

  async isTxComplete(txId: string, minConfirmations?: number): Promise<boolean> {
    const transaction = await this.getTx(txId);
    return transaction.blockhash && transaction.confirmations > minConfirmations;
  }
}
