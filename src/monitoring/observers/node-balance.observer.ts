import { AccountResult } from '@defichain/jellyfish-api-core/dist/category/account';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import BigNumber from 'bignumber.js';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';

interface NodeBalanceData {
  balance: {
    defichain: {
      input: {
        utxo: BigNumber;
        token: AccountResult<string, string>[];
      };
      ref: {
        utxo: BigNumber;
        token: AccountResult<string, string>[];
      };
    };
  };
}

@Injectable()
export class NodeBalanceObserver extends MetricObserver<NodeBalanceData> {
  private inpClient: NodeClient;
  private refClient: NodeClient;

  constructor(monitoringService: MonitoringService, readonly nodeService: NodeService) {
    super(monitoringService, 'node', 'balance');

    nodeService.getConnectedNode(NodeType.INPUT).subscribe((client) => (this.inpClient = client));
    nodeService.getConnectedNode(NodeType.REF).subscribe((client) => (this.refClient = client));
  }

  @Interval(900000)
  async fetch(): Promise<NodeBalanceData> {
    const data = await this.getNode();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getNode(): Promise<NodeBalanceData> {
    return {
      balance: {
        defichain: {
          input: await this.inpClient.getNodeBalance(),
          ref: await this.refClient.getNodeBalance(),
        },
      },
    };
  }
}
