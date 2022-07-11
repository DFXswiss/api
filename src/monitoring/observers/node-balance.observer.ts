import { AccountResult } from '@defichain/jellyfish-api-core/dist/category/account';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import BigNumber from 'bignumber.js';
// import { BtcClient } from 'src/ain/node/btc-client';
import { DeFiClient } from 'src/ain/node/defi-client';
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
    /*bitcoin: {
      input: BigNumber; // TODO: setup btc node and activate monitoring again
    };*/
  };
}

@Injectable()
export class NodeBalanceObserver extends MetricObserver<NodeBalanceData> {
  private inpClient: DeFiClient;
  private refClient: DeFiClient;
  // private btcInpClient: BtcClient; TODO: setup btc node and activate monitoring again

  constructor(monitoringService: MonitoringService, readonly nodeService: NodeService) {
    super(monitoringService, 'node', 'balance');

    nodeService.getConnectedNode<NodeType.INPUT>(NodeType.INPUT).subscribe((client) => (this.inpClient = client));
    nodeService.getConnectedNode<NodeType.REF>(NodeType.REF).subscribe((client) => (this.refClient = client));
    // nodeService
    //   .getConnectedNode<NodeType.BTC_INPUT>(NodeType.BTC_INPUT)
    //   .subscribe((client) => (this.btcInpClient = client)); TODO: setup btc node and activate monitoring again
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
        /* bitcoin: {
          input: await this.btcInpClient.getBalance(), // TODO: setup btc node and activate monitoring again
        }, */
      },
    };
  }
}
