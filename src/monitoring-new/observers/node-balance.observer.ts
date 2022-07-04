import { Injectable, NotImplementedException } from '@nestjs/common';
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
    super(monitoringService, 'blockchain', 'node-balance');

    nodeService.getConnectedNode(NodeType.INPUT).subscribe((client) => (this.inpClient = client));
    nodeService.getConnectedNode(NodeType.REF).subscribe((client) => (this.refClient = client));
  }

  async fetch() {
    const data = await this.getNode();

    this.emit(data);

    return data;
  }

  onWebhook() {
    throw new NotImplementedException('Webhook is not supported by this metric. Ignoring incoming data');
  }

  async compare() {
    // no comparison required in this Observer
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
