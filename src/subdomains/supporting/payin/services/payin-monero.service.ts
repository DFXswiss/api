import { Injectable } from '@nestjs/common';
import { MoneroTransactionType, MoneroTransferDto } from 'src/integration/blockchain/monero/dto/monero.dto';
import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInBitcoinBasedService } from './base/payin-bitcoin-based.service';

@Injectable()
export class PayInMoneroService extends PayInBitcoinBasedService {
  private readonly client: MoneroClient;

  constructor(private readonly moneroService: MoneroService) {
    super();
    this.client = moneroService.getDefaultClient();
  }

  async checkHealthOrThrow(): Promise<void> {
    const isHealthy = await this.moneroService.isHealthy();
    if (!isHealthy) throw new Error('Monero node is unhealthy');
  }

  async getBlockHeight(): Promise<number> {
    return this.moneroService.getBlockHeight();
  }

  async checkTransactionCompletion(txId: string, minConfirmations: number): Promise<boolean> {
    return this.client.isTxComplete(txId, minConfirmations);
  }

  async getTransactionHistory(startBlockHeight: number): Promise<MoneroTransferDto[]> {
    return this.client.getTransfers(MoneroTransactionType.in, startBlockHeight);
  }

  async sendTransfer(payIn: CryptoInput): Promise<{ outTxId: string; feeAmount: number }> {
    return this.client
      .sendTransfer(payIn.destinationAddress.address, payIn.sendingAmount)
      .then((r) => ({ outTxId: r.txid, feeAmount: r.fee }));
  }
}
