import { Injectable } from '@nestjs/common';
import {
  MoneroTransactionDto,
  MoneroTransactionType,
  MoneroTransferDto,
} from 'src/integration/blockchain/monero/dto/monero.dto';
import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { CryptoInput } from '../entities/crypto-input.entity';

@Injectable()
export class PayInMoneroService {
  private client: MoneroClient;

  constructor(private moneroService: MoneroService) {
    this.client = moneroService.getDefaultClient();
  }

  async isHealthy(): Promise<boolean> {
    return this.moneroService.isHealthy();
  }

  async getTransaction(txId: string): Promise<MoneroTransactionDto> {
    return this.client.getTransaction(txId);
  }

  async getTransactionHistory(startBlockHeight: number): Promise<MoneroTransferDto[]> {
    return this.client.getTransfers(MoneroTransactionType.in, startBlockHeight);
  }

  async sendTransfer(payIn: CryptoInput): Promise<MoneroTransferDto> {
    return this.client.sendTransfer(payIn.address.address, payIn.amount);
  }
}
