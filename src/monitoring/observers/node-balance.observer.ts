import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import BigNumber from 'bignumber.js';
import { BtcClient } from 'src/blockchain/ain/node/btc-client';
import { DeFiClient } from 'src/blockchain/ain/node/defi-client';
import { NodeService, NodeType } from 'src/blockchain/ain/node/node.service';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';

interface NodeBalanceData {
  balance: {
    defichain: {
      input: {
        utxo: BigNumber;
        token: number;
      };
      ref: {
        utxo: BigNumber;
        token: number;
      };
    };
    bitcoin: {
      input: BigNumber;
    };
  };
}

@Injectable()
export class NodeBalanceObserver extends MetricObserver<NodeBalanceData> {
  private inpClient: DeFiClient;
  private refClient: DeFiClient;
  private btcInpClient: BtcClient;

  constructor(monitoringService: MonitoringService, readonly nodeService: NodeService) {
    super(monitoringService, 'node', 'balance');

    nodeService.getConnectedNode<NodeType.INPUT>(NodeType.INPUT).subscribe((client) => (this.inpClient = client));
    nodeService.getConnectedNode<NodeType.REF>(NodeType.REF).subscribe((client) => (this.refClient = client));
    nodeService
      .getConnectedNode<NodeType.BTC_INPUT>(NodeType.BTC_INPUT)
      .subscribe((client) => (this.btcInpClient = client));
  }

  @Interval(900000)
  async fetch(): Promise<NodeBalanceData> {
    const data = await this.getNode();

    this.emit(data);

    return data;
  }

  // --- HELPER METHODS --- //
  private async getNode(): Promise<NodeBalanceData> {
    return {
      balance: {
        defichain: {
          input: await this.inpClient.getNodeBalance(),
          ref: await this.refClient.getNodeBalance(),
        },
        bitcoin: {
          input: (await this.btcInpClient?.getBalance()) ?? new BigNumber(0),
        },
      },
    };
  }
}
