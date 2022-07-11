import { SchedulerRegistry } from '@nestjs/schedule';
import { HttpService } from 'src/shared/services/http.service';
import { NodeClient, NodeCommand, NodeMode } from './node-client';

export class BtcClient extends NodeClient {
  constructor(http: HttpService, url: string, scheduler: SchedulerRegistry, mode: NodeMode) {
    super(http, url, scheduler, mode);
  }

  async send(addressTo: string, txId: string, amount: number, vout: number): Promise<string> {
    return this.callNode(
      (c) =>
        c.call(
          NodeCommand.SEND,
          [
            [{ [addressTo]: this.roundAmount(amount - this.btcUtxoFee) }],
            null,
            'unset',
            null,
            { inputs: [{ txid: txId, vout: vout }], replaceable: true },
          ],
          'number',
        ),
      true,
    );
  }

  get btcUtxoFee(): number {
    return 0.000083;
  }
}
