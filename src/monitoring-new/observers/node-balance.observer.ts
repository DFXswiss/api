import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { MetricObserver } from 'src/monitoring-new/metric.observer';
import { MonitoringService } from 'src/monitoring-new/monitoring.service';

export interface NodeBalanceData {
  balance: {
    defichain: {
      input: number;
      ref: number;
    };
  };
}

@Injectable()
export class NodeBalanceObserver extends MetricObserver<NodeBalanceData> {
  private inpClient: NodeClient;
  private refClient: NodeClient;

  constructor(monitoringService: MonitoringService, readonly nodeService: NodeService) {
    super(monitoringService, 'node', 'nodeBalance');

    nodeService.getConnectedNode(NodeType.INPUT).subscribe((client) => (this.inpClient = client));
    nodeService.getConnectedNode(NodeType.REF).subscribe((client) => (this.refClient = client));
  }

  @Interval(60000)
  async fetch() {
    const data = await this.getNode();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getNode(): Promise<any> {
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
