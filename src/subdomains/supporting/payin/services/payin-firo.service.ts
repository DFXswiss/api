import { Injectable } from '@nestjs/common';
import { BitcoinUTXO } from 'src/integration/blockchain/bitcoin/node/dto/bitcoin-transaction.dto';
import { InWalletTransaction } from 'src/integration/blockchain/bitcoin/node/node-client';
import { FiroClient } from 'src/integration/blockchain/firo/firo-client';
import { FiroFeeService } from 'src/integration/blockchain/firo/services/firo-fee.service';
import { FiroService } from 'src/integration/blockchain/firo/services/firo.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { CryptoInput, PayInStatus } from '../entities/crypto-input.entity';
import { PayInBitcoinBasedService, UnconfirmedPayInFilterResult } from './base/payin-bitcoin-based.service';

@Injectable()
export class PayInFiroService extends PayInBitcoinBasedService {
  private readonly logger = new DfxLogger(PayInFiroService);

  private readonly client: FiroClient;

  private readonly nodeCallQueue = QueueHandler.createParallelQueueHandler(5);

  constructor(
    firoService: FiroService,
    private readonly feeService: FiroFeeService,
  ) {
    super();

    this.client = firoService.getDefaultClient();
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

    // Firo's getrawtransaction includes address/value directly in vin (not nested in prevout like Bitcoin Core verbosity=2).
    // Read vin.address directly - no need to look up each input's previous TX.
    await Promise.all(
      utxos.map((utxo) =>
        this.nodeCallQueue.handle(async () => {
          const transaction = await this.client.getRawTx(utxo.txid);
          if (!transaction) return;

          const senderAddresses = transaction.vin.filter((vin) => vin.address).map((vin) => vin.address);
          utxo.prevoutAddresses = [...new Set(senderAddresses)];
          utxo.isUnconfirmed = utxo.confirmations === 0;
        }),
      ),
    );

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
            utxo.isNextBlockCandidate = false;
          }
        }
      }

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
    const feeRate = await this.feeService.getRecommendedFeeRate();
    return this.client.send(
      input.destinationAddress.address,
      input.inTxId,
      input.sendingAmount,
      input.txSequence,
      feeRate,
    );
  }

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
          this.logger.warn(`PayIn ${payIn.id}: TX ${payIn.inTxId} not in mempool - marking as FAILED`);
          payIn.status = PayInStatus.FAILED;
          failedPayIns.push(payIn);
          break;

        case 'confirmed':
          this.logger.verbose(`PayIn ${payIn.id}: TX ${payIn.inTxId} already confirmed - skipping unconfirmed forward`);
          break;

        case 'error':
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
