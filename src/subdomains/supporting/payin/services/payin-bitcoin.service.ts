import { Injectable } from '@nestjs/common';
import { InWalletTransaction } from 'src/integration/blockchain/bitcoin/node/node-client';
import { BitcoinClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-client';
import { BitcoinNodeType, BitcoinService } from 'src/integration/blockchain/bitcoin/node/bitcoin.service';
import { BitcoinTransaction, BitcoinUTXO } from 'src/integration/blockchain/bitcoin/node/dto/bitcoin-transaction.dto';
import { BitcoinFeeService } from 'src/integration/blockchain/bitcoin/services/bitcoin-fee.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { CryptoInput, PayInStatus } from '../entities/crypto-input.entity';
import { PayInBitcoinBasedService } from './base/payin-bitcoin-based.service';

export interface UnconfirmedPayInFilterResult {
  nextBlockCandidates: CryptoInput[];
  failedPayIns: CryptoInput[];
}

@Injectable()
export class PayInBitcoinService extends PayInBitcoinBasedService {
  private readonly logger = new DfxLogger(PayInBitcoinService);

  private readonly client: BitcoinClient;
  private readonly liqClient: BitcoinClient;

  // Limit parallel Bitcoin node calls to prevent overload
  private readonly nodeCallQueue = QueueHandler.createParallelQueueHandler(5);

  constructor(
    readonly bitcoinService: BitcoinService,
    private readonly feeService: BitcoinFeeService,
  ) {
    super();

    this.client = bitcoinService.getDefaultClient(BitcoinNodeType.BTC_INPUT);
    this.liqClient = bitcoinService.getDefaultClient(BitcoinNodeType.BTC_OUTPUT);
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
          const senderAddresses = transaction.vin.map((vin) => vin.prevout.scriptPubKey.address);
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

  async getTx(outTxId: string): Promise<InWalletTransaction | null> {
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

  async sendFromLiquidity(addressTo: string, amount: number): Promise<string> {
    const feeRate = await this.feeService.getRecommendedFeeRate();
    return this.liqClient.sendMany([{ addressTo, amount }], feeRate);
  }

  /**
   * Filters unconfirmed PayIns to find next-block candidates.
   * Returns PayIns ready to forward and PayIns that should be marked as FAILED (evicted from mempool).
   */
  async filterUnconfirmedPayInsForForward(payIns: CryptoInput[]): Promise<UnconfirmedPayInFilterResult> {
    if (payIns.length === 0) {
      return { nextBlockCandidates: [], failedPayIns: [] };
    }

    const fastestFee = await this.feeService.getRecommendedFeeRate();
    const txids = payIns.map((p) => p.inTxId);
    const feeRates = await this.feeService.getTxFeeRates(txids);

    const nextBlockCandidates: CryptoInput[] = [];
    const failedPayIns: CryptoInput[] = [];

    for (const payIn of payIns) {
      const result = feeRates.get(payIn.inTxId);

      if (!result) {
        this.logger.warn(`PayIn ${payIn.id}: No fee rate result for TX ${payIn.inTxId} - skipping`);
        continue;
      }

      switch (result.status) {
        case 'not_found':
          // TX evicted from mempool → mark as FAILED
          this.logger.warn(`PayIn ${payIn.id}: TX ${payIn.inTxId} not in mempool - marking as FAILED`);
          payIn.status = PayInStatus.FAILED;
          failedPayIns.push(payIn);
          break;

        case 'confirmed':
          // TX already confirmed → will be picked up by regular confirmation process
          this.logger.verbose(`PayIn ${payIn.id}: TX ${payIn.inTxId} already confirmed - skipping unconfirmed forward`);
          break;

        case 'error':
          // API error for this TX - skip, don't mark as failed
          this.logger.warn(`PayIn ${payIn.id}: API error checking TX ${payIn.inTxId} - skipping`);
          break;

        case 'unconfirmed':
          if (result.feeRate !== undefined && result.feeRate >= fastestFee) {
            nextBlockCandidates.push(payIn);
          } else {
            this.logger.verbose(
              `PayIn ${payIn.id}: Fee rate ${result.feeRate} < ${fastestFee} - waiting for confirmation`,
            );
          }
          break;
      }
    }

    return { nextBlockCandidates, failedPayIns };
  }
}
