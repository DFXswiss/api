import { Injectable } from '@nestjs/common';
import { BitcoinClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-client';
import { BitcoinTransaction, BitcoinUTXO } from 'src/integration/blockchain/bitcoin/node/dto/bitcoin-transaction.dto';
import { InWalletTransaction } from 'src/integration/blockchain/bitcoin/node/node-client';
import { BitcoinFeeService } from 'src/integration/blockchain/bitcoin/services/bitcoin-fee.service';
import { BitcoinService } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInBitcoinBasedService } from './base/payin-bitcoin-based.service';

@Injectable()
export class PayInBitcoinService extends PayInBitcoinBasedService {
  private readonly logger = new DfxLogger(PayInBitcoinService);

  private readonly client: BitcoinClient;

  // Limit parallel Bitcoin node calls to prevent overload
  private readonly nodeCallQueue = QueueHandler.createParallelQueueHandler(5);

  constructor(
    bitcoinService: BitcoinService,
    private readonly feeService: BitcoinFeeService,
  ) {
    super();

    this.client = bitcoinService.getDefaultClient();
  }

  isAvailable(): boolean {
    return this.client != null;
  }

  async checkHealthOrThrow(): Promise<void> {
    await this.client.checkSync();
  }

  async getBlockHeight(): Promise<number> {
    return this.client.getBlockCount();
  }

  async getUtxo(includeUnconfirmed = false): Promise<BitcoinUTXO[]> {
    const utxos = <BitcoinUTXO[]>await this.client.getUtxo(includeUnconfirmed);

    // Enrich UTXOs with sender addresses (throttled parallel execution)
    await Promise.all(
      utxos.map((utxo) =>
        this.nodeCallQueue.handle(async () => {
          const command = `getrawtransaction "${utxo.txid}" 2`;
          const transaction = <BitcoinTransaction>await this.client.sendCliCommand(command);
          const senderAddresses = transaction.vin
            .filter((vin) => vin.prevout?.scriptPubKey?.address)
            .map((vin) => vin.prevout.scriptPubKey.address);
          utxo.prevoutAddresses = [...new Set(senderAddresses)];
          utxo.isUnconfirmed = utxo.confirmations === 0;
        }),
      ),
    );

    // For unconfirmed UTXOs: check fee rates in parallel
    if (includeUnconfirmed) {
      const unconfirmedUtxos = utxos.filter((u) => u.isUnconfirmed);

      if (unconfirmedUtxos.length > 0) {
        const fastestFee = await this.feeService.getRecommendedFeeRate();
        const txids = unconfirmedUtxos.map((u) => u.txid);
        const feeRates = await this.feeService.getTxFeeRates(txids);

        for (const utxo of unconfirmedUtxos) {
          const result = feeRates.get(utxo.txid);
          if (result?.status === 'unconfirmed' && result.feeRate !== undefined) {
            utxo.feeRate = result.feeRate;
            utxo.isNextBlockCandidate = result.feeRate >= fastestFee;
          } else {
            // TX confirmed, not found, error, or API error → not a next-block candidate
            utxo.isNextBlockCandidate = false;
          }
        }
      }

      // Filter: Only return confirmed UTXOs or unconfirmed next-block candidates
      return utxos.filter((u) => !u.isUnconfirmed || u.isNextBlockCandidate);
    }

    return utxos;
  }

  async checkTransactionCompletion(txId: string, minConfirmations: number): Promise<boolean> {
    return this.client.isTxComplete(txId, minConfirmations);
  }

  async sendTransfer(): Promise<{ outTxId: string; feeAmount: number }> {
    throw new Error('Bitcoin does not use forwarding');
  }

  async filterUnconfirmedPayInsForForward(): Promise<{
    nextBlockCandidates: CryptoInput[];
    failedPayIns: CryptoInput[];
  }> {
    // Bitcoin does not use forwarding — no unconfirmed forward candidates
    return { nextBlockCandidates: [], failedPayIns: [] };
  }

  async getTx(outTxId: string): Promise<InWalletTransaction | null> {
    return this.client.getTx(outTxId);
  }
}
