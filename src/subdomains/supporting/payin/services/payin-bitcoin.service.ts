import { InWalletTransaction } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Injectable } from '@nestjs/common';
import { BtcClient } from 'src/integration/blockchain/ain/node/btc-client';
import { BitcoinTransaction, BitcoinUTXO } from 'src/integration/blockchain/ain/node/dto/btc-transaction.dto';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { BtcFeeService } from 'src/integration/blockchain/ain/services/btc-fee.service';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInBitcoinBasedService } from './base/payin-bitcoin-based.service';

@Injectable()
export class PayInBitcoinService extends PayInBitcoinBasedService {
  private client: BtcClient;

  constructor(private readonly feeService: BtcFeeService, nodeService: NodeService) {
    super();
    nodeService.getConnectedNode(NodeType.BTC_INPUT).subscribe((client) => (this.client = client));
  }

  async checkHealthOrThrow(): Promise<void> {
    await this.client.checkSync();
  }

  async getUtxo(): Promise<BitcoinUTXO[]> {
    const utxos = <BitcoinUTXO[]>await this.client.getUtxo();

    for (const utxo of utxos) {
      const command = `getrawtransaction "${utxo.txid}" 2`;
      const transaction = <BitcoinTransaction>await this.client.sendCliCommand(command);
      const senderAddresses = transaction.vin.map((vin) => vin.prevout.scriptPubKey.address);
      utxo.prevoutAddresses = [...new Set(senderAddresses)];
    }

    return utxos;
  }

  async getTx(outTxId: string): Promise<InWalletTransaction> {
    return this.client.getTx(outTxId);
  }

  async sendTransfer(input: CryptoInput): Promise<{ outTxId: string; feeAmount: number }> {
    return this.client.send(
      input.destinationAddress.address,
      input.inTxId,
      input.sendingAmount,
      input.txSequence,
      await this.feeService.getRecommendedFeeRate(),
    );
  }
}
