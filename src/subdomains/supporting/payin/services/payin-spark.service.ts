import { Injectable } from '@nestjs/common';
import { SparkClient, SparkTransfer } from 'src/integration/blockchain/spark/spark-client';
import { SparkService } from 'src/integration/blockchain/spark/spark.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoInput } from '../entities/crypto-input.entity';

@Injectable()
export class PayInSparkService {
  private readonly logger = new DfxLogger(PayInSparkService);

  private readonly client: SparkClient;

  constructor(private readonly service: SparkService) {
    this.client = service.getDefaultClient();
  }

  getWalletAddress(): string {
    return this.client.walletAddress;
  }

  async checkHealthOrThrow(): Promise<void> {
    const isHealthy = await this.client.isHealthy();
    if (!isHealthy) throw new Error('Spark node is unhealthy');
  }

  async getIncomingTransfers(limit = 100, offset = 0): Promise<SparkTransfer[]> {
    return this.client.getIncomingTransfers(limit, offset);
  }

  async sendTransfer(payIn: CryptoInput): Promise<{ outTxId: string; feeAmount: number }> {
    const { txid, fee } = await this.client.sendTransaction(payIn.destinationAddress.address, payIn.sendingAmount);

    return { outTxId: txid, feeAmount: fee };
  }

  async isTxComplete(txId: string): Promise<boolean> {
    return this.client.isTxComplete(txId);
  }
}
