import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Injectable } from '@nestjs/common';
import { BtcClient } from 'src/integration/blockchain/ain/node/btc-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { BtcFeeService } from 'src/integration/blockchain/ain/services/btc-fee.service';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInJellyfishService } from './base/payin-jellyfish.service';

@Injectable()
export class PayInBitcoinService extends PayInJellyfishService {
  private client: BtcClient;

  constructor(private readonly feeService: BtcFeeService, nodeService: NodeService) {
    super();
    nodeService.getConnectedNode(NodeType.BTC_INPUT).subscribe((client) => (this.client = client));
  }

  async checkHealthOrThrow(): Promise<void> {
    await this.checkNodeInSync(this.client);
  }

  async getUTXO(): Promise<UTXO[]> {
    await this.client.checkSync();

    return this.client.getUtxo();
  }

  async sendUtxo(input: CryptoInput): Promise<{ outTxId: string; feeAmount: number }> {
    return this.client.send(
      input.destinationAddress.address,
      input.inTxId,
      input.amount,
      input.txSequence,
      await this.getFeeRate(input.amount),
    );
  }

  //*** HELPER METHODS ***//

  private async getFeeRate(amount: number): Promise<number> {
    const feeRate = await this.feeService.getRecommendedFeeRate();
    return Math.floor(Math.max(Math.min(feeRate, 500 * amount), 1));
  }
}
