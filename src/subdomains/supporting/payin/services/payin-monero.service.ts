import { Injectable } from '@nestjs/common';
import {
  GetTransferInResultDto,
  MoneroTransactionDto,
  TransferResultDto,
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

  async getTransactionHistory(startTxId: string): Promise<GetTransferInResultDto[]> {
    const result: GetTransferInResultDto[] = [];

    const startTransactionResult = await this.getTransaction(startTxId);
    const startBlockHeight = startTransactionResult.block_height;

    if (startBlockHeight) {
      const transferResult = await this.client.getTransfers(startBlockHeight);
      result.push(...transferResult.in);
    }

    return result;
  }

  async sendTransfer(payIn: CryptoInput): Promise<TransferResultDto> {
    return this.client.transfer(payIn.address.address, payIn.amount);
  }
}
