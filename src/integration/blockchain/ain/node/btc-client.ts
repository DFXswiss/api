import { SchedulerRegistry } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { NodeClient, NodeCommand, NodeMode } from './node-client';

export class BtcClient extends NodeClient {
  constructor(http: HttpService, url: string, scheduler: SchedulerRegistry, mode: NodeMode) {
    super(http, url, scheduler, mode);
  }

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

    return await this.callNode<{ txid: string }>(
      (c) =>
        c.call(
          NodeCommand.SEND,
          [
            batch,
            null,
            'unset',
            null,
            { fee_rate: feeRate, replaceable: true, change_address: Config.blockchain.default.btcOutWalletAddress },
          ],
          'number',
        ),
      true,
    ).then((r) => r.txid);
  }
}
