import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { BitcoinClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-client';
import { BitcoinNodeType, BitcoinService } from 'src/integration/blockchain/bitcoin/node/bitcoin.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';

interface NodeBalanceData {
  balance: {
    bitcoin: {
      input: number;
    };
  };
}

@Injectable()
export class NodeBalanceObserver extends MetricObserver<NodeBalanceData> {
  protected readonly logger = new DfxLogger(NodeBalanceObserver);

  private readonly bitcoinClient: BitcoinClient;

  constructor(
    monitoringService: MonitoringService,
    readonly bitcoinService: BitcoinService,
  ) {
    super(monitoringService, 'node', 'balance');

    this.bitcoinClient = bitcoinService.getDefaultClient(BitcoinNodeType.BTC_INPUT);
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.MONITORING, timeout: 1800 })
  async fetch(): Promise<NodeBalanceData> {
    const data = await this.getNode();

    this.emit(data);

    return data;
  }

  // --- HELPER METHODS --- //
  private async getNode(): Promise<NodeBalanceData> {
    return {
      balance: {
        bitcoin: {
          input: (await this.bitcoinClient?.getBalance()) ?? 0,
        },
      },
    };
  }
}
