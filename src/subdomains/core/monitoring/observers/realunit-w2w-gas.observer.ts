import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config, Environment } from 'src/config/config';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { SepoliaService } from 'src/integration/blockchain/sepolia/sepolia.service';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';

// --- W2W TRANSFER --- //

interface RealUnitW2wGasData {
  address?: string;
  balance?: number; // ETH
  threshold: number; // ETH
  lowBalance: boolean;
}

/**
 * Monitors the ETH balance of the dedicated RealUnit wallet-to-wallet (W2W) gas-funding wallet
 * (read-only via Config.blockchain.realunit.w2wGasWalletAddress — the private key is never needed
 * here) and raises the standard low-balance monitoring alert when it drops below the configured
 * threshold so the operator can top it up before user transfers start failing.
 */
@Injectable()
export class RealUnitW2wGasObserver extends MetricObserver<RealUnitW2wGasData> {
  protected readonly logger = new DfxLogger(RealUnitW2wGasObserver);

  constructor(
    monitoringService: MonitoringService,
    private readonly ethereumService: EthereumService,
    private readonly sepoliaService: SepoliaService,
    private readonly notificationService: NotificationService,
  ) {
    super(monitoringService, 'realUnit', 'w2wGasBalance');
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.MONITORING, timeout: 1800 })
  async fetch(): Promise<RealUnitW2wGasData> {
    const data = await this.getData();

    if (data.lowBalance) await this.alertLowBalance(data);

    this.emit(data);

    return data;
  }

  // --- HELPER METHODS --- //

  private async getData(): Promise<RealUnitW2wGasData> {
    const { w2wGasWalletAddress, w2wGasLowBalanceThreshold } = Config.blockchain.realunit;

    if (!w2wGasWalletAddress) {
      return { address: undefined, balance: undefined, threshold: w2wGasLowBalanceThreshold, lowBalance: false };
    }

    const balance = await this.getClient().getNativeCoinBalanceForAddress(w2wGasWalletAddress);

    return {
      address: w2wGasWalletAddress,
      balance,
      threshold: w2wGasLowBalanceThreshold,
      lowBalance: balance < w2wGasLowBalanceThreshold,
    };
  }

  private async alertLowBalance(data: RealUnitW2wGasData): Promise<void> {
    const message = `RealUnit W2W gas wallet ${data.address} balance ${data.balance} ETH is below threshold ${data.threshold} ETH`;
    this.logger.error(message);

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: {
        subject: 'RealUnit W2W gas wallet low balance',
        errors: [message],
      },
    });
  }

  private getClient(): EvmClient {
    return [Environment.DEV, Environment.LOC].includes(Config.environment)
      ? this.sepoliaService.getDefaultClient()
      : this.ethereumService.getDefaultClient();
  }
}
