import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import BigNumber from 'bignumber.js';
import { BtcClient } from 'src/integration/blockchain/ain/node/btc-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
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
  protected readonly logger = new DfxLogger(NodeBalanceObserver);

  private btcInpClient: BtcClient;

  constructor(monitoringService: MonitoringService, readonly nodeService: NodeService) {
    super(monitoringService, 'node', 'balance');

    nodeService
      .getConnectedNode<NodeType.BTC_INPUT>(NodeType.BTC_INPUT)
      .subscribe((client) => (this.btcInpClient = client));
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock(1800)
  async fetch(): Promise<NodeBalanceData> {
    if (DisabledProcess(Process.MONITORING)) return;

    const data = await this.getNode();

    this.emit(data);

    return data;
  }

  // --- HELPER METHODS --- //
  private async getNode(): Promise<NodeBalanceData> {
    return {
      balance: {
        bitcoin: {
          input: (await this.btcInpClient?.getBalance()) ?? new BigNumber(0),
        },
      },
    };
  }
}
