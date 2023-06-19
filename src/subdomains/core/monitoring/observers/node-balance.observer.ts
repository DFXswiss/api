import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import BigNumber from 'bignumber.js';
import { Config, Process } from 'src/config/config';
import { BtcClient } from 'src/integration/blockchain/ain/node/btc-client';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';

interface NodeBalanceData {
  balance: {
    defichain: {
      input: {
        utxo: BigNumber;
        token: number;
      };
    };
    bitcoin: {
      input: BigNumber;
    };
    lightning: { confirmedWallet: number; localChannel: number; remoteChannel: number };
  };
}

@Injectable()
export class NodeBalanceObserver extends MetricObserver<NodeBalanceData> {
  protected readonly logger = new DfxLogger(NodeBalanceObserver);

  private inpClient: DeFiClient;
  private btcInpClient: BtcClient;
  private lndClient: LightningClient;

  constructor(
    monitoringService: MonitoringService,
    readonly nodeService: NodeService,
    readonly lightningService: LightningService,
  ) {
    super(monitoringService, 'node', 'balance');

    nodeService.getConnectedNode<NodeType.INPUT>(NodeType.INPUT).subscribe((client) => (this.inpClient = client));
    nodeService
      .getConnectedNode<NodeType.BTC_INPUT>(NodeType.BTC_INPUT)
      .subscribe((client) => (this.btcInpClient = client));
    this.lndClient = lightningService.getDefaultClient();
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock(1800)
  async fetch(): Promise<NodeBalanceData> {
    if (Config.processDisabled(Process.MONITORING)) return;

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
        },
        bitcoin: {
          input: (await this.btcInpClient?.getBalance()) ?? new BigNumber(0),
        },
        lightning: {
          confirmedWallet: await this.lndClient.getLndConfirmedWalletBalance(),
          localChanel: await this.lndClient.getLndLocalChannelBalance(),
          remoteChannel: await this.lndClient.getLndRemoteChannelBalance(),
        },
      },
    };
  }
}
