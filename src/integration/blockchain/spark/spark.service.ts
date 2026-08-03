import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Bech32mService } from '../shared/bech32m/bech32m.service';
import { SparkClient, SparkTransaction } from './spark-client';

@Injectable()
export class SparkService extends Bech32mService {
  readonly defaultPrefix = 'spark';

  private readonly client: SparkClient;

  constructor() {
    super();
    this.client = new SparkClient();
  }

  getDefaultClient(): SparkClient {
    return this.client;
  }

  /**
   * Wallet maintenance: consolidates the token outputs of the Spark wallet.
   *
   * The client used to run this from a `setInterval` of its own with a role check in front of it.
   * A timer outside the scheduler is invisible to the scope AND to the cross-process lease, so the
   * role check was the only thing standing between two processes and the same wallet — and it
   * cannot help in the case that matters, where both processes legitimately hold a role that
   * includes this work. That is every deployment, for as long as the outgoing container is still
   * up. Registered here, it goes through the lease like any other worker job.
   *
   * Errors are left to the wrapper, per CONTRIBUTING ("@DfxCron already handles errors"). Catching
   * them here to log them again was the redundant try-catch that rule names; what it added over
   * the wrapper was a lower log level, which is not worth an exception to the rule.
   */
  @DfxCron(CronExpression.EVERY_5_MINUTES, { scope: CronScope.WORKER, process: Process.SPARK_TOKEN_OPTIMIZATION })
  async optimizeTokenOutputs(): Promise<void> {
    await this.client.optimizeTokenOutputs();
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }

  // --- TRANSACTION METHODS --- //

  async sendTransaction(to: string, amount: number): Promise<{ txid: string; fee: number }> {
    return this.client.sendTransaction(to, amount);
  }

  async getTransaction(txId: string): Promise<SparkTransaction> {
    return this.client.getTransaction(txId);
  }

  async getNativeFee(): Promise<number> {
    return this.client.getNativeFee();
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.client.getTxActualFee(txHash);
  }
}
