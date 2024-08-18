import { InWalletTransaction, UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Injectable } from '@nestjs/common';
import { BtcClient } from 'src/integration/blockchain/ain/node/btc-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { BtcFeeService } from 'src/integration/blockchain/ain/services/btc-fee.service';
import { CryptoInput } from '../entities/crypto-input.entity';
import { SendType } from '../strategies/send/impl/base/send.strategy';
import { PayInJellyfishService } from './base/payin-jellyfish.service';

@Injectable()
export class PayInBitcoinService extends PayInJellyfishService {
  private client: BtcClient;

  constructor(private readonly feeService: BtcFeeService, nodeService: NodeService) {
    super();
    nodeService.getConnectedNode(NodeType.BTC_INPUT).subscribe((client) => (this.client = client));
  }

  async checkHealthOrThrow(): Promise<void> {
    await this.client.checkSync();
  }

  async getUtxo(): Promise<UTXO[]> {
    return this.client.getUtxo();
  }

  async getTx(outTxId: string): Promise<InWalletTransaction> {
    return this.client.getTx(outTxId);
  }

  async sendUtxo(input: CryptoInput, type: SendType): Promise<{ outTxId: string; feeAmount: number }> {
    return this.client.send(
      input.destinationAddress.address,
      input.inTxId,
      input.sendingAmount(type),
      input.txSequence,
      await this.feeService.getRecommendedFeeRate(),
    );
  }
}
