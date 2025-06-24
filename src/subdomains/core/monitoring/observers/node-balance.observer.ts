import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import BigNumber from 'bignumber.js';
import { BitcoinClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-client';
import { BitcoinNodeType, BitcoinService } from 'src/integration/blockchain/bitcoin/node/bitcoin.service';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';

interface NodeBalanceData {
  balance: {
    bitcoin: {
      input: BigNumber;
    };
  };
}

@Injectable()
export class NodeBalanceObserver extends MetricObserver<NodeBalanceData> {
  protected readonly logger: DfxLoggerService;

  private readonly bitcoinClient: BitcoinClient;

  constructor(
    monitoringService: MonitoringService,
    readonly bitcoinService: BitcoinService,
    private readonly dfxLogger: DfxLoggerService,
  ) {
    super(monitoringService, 'node', 'balance');

    this.bitcoinClient = bitcoinService.getDefaultClient(BitcoinNodeType.BTC_INPUT);
    this.logger = this.dfxLogger.create(NodeBalanceObserver);
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
          input: (await this.bitcoinClient?.getBalance()) ?? new BigNumber(0),
        },
      },
    };
  }
}
