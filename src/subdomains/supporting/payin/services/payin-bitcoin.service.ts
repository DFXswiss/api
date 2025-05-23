import { InWalletTransaction } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Injectable } from '@nestjs/common';
import { BitcoinClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-client';
import { BitcoinService, BitcoinType } from 'src/integration/blockchain/bitcoin/node/bitcoin.service';
import { BitcoinTransaction, BitcoinUTXO } from 'src/integration/blockchain/bitcoin/node/dto/bitcoin-transaction.dto';
import { BitcoinFeeService } from 'src/integration/blockchain/bitcoin/services/bitcoin-fee.service';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInBitcoinBasedService } from './base/payin-bitcoin-based.service';

@Injectable()
export class PayInBitcoinService extends PayInBitcoinBasedService {
  private readonly client: BitcoinClient;

  constructor(readonly bitcoinService: BitcoinService, private readonly feeService: BitcoinFeeService) {
    super();

    this.client = bitcoinService.getDefaultClient(BitcoinType.BTC_INPUT);
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

  async checkTransactionCompletion(txId: string, minConfirmations: number): Promise<boolean> {
    return this.client.isTxComplete(txId, minConfirmations);
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
