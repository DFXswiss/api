import { SchedulerRegistry } from '@nestjs/schedule';
import { HttpService } from 'src/shared/services/http.service';
import { NodeClient, NodeCommand, NodeMode } from './node-client';

export class BtcClient extends NodeClient {
  constructor(http: HttpService, url: string, scheduler: SchedulerRegistry, mode: NodeMode) {
    super(http, url, scheduler, mode);
  }

  async send(addressTo: string, txId: string, amount: number, vout: number, feeRate: number): Promise<string> {
    //135 vByte for a single-input single-output TX
    const feeAmount = (feeRate / (10 ^ 8)) * 135;

    return this.callNode(
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
  }
}
