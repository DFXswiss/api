import { Injectable } from '@nestjs/common';
import {
  MoneroTransactionDto,
  MoneroTransactionType,
  MoneroTransferDto,
} from 'src/integration/blockchain/monero/dto/monero.dto';
import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { BlockchainClient } from 'src/integration/blockchain/shared/util/blockchain-client';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInBitcoinBasedService } from './base/payin-bitcoin-based.service';

@Injectable()
export class PayInMoneroService extends PayInBitcoinBasedService {
  private client: MoneroClient;

  constructor(private moneroService: MoneroService) {
    super();
    this.client = moneroService.getDefaultClient();
  }

  public getDefaultClient(): BlockchainClient {
    return this.client;
  }

  async checkHealthOrThrow(): Promise<void> {
    const isHealthy = this.moneroService.isHealthy();
    if (!isHealthy) throw new Error('Monero node is unhealthy');
  }

  async getTransaction(txId: string): Promise<MoneroTransactionDto> {
    return this.client.getTransaction(txId);
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
