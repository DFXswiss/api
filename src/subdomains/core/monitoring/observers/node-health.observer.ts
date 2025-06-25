import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { BitcoinNodeType, BitcoinService } from 'src/integration/blockchain/bitcoin/node/bitcoin.service';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';

interface NodePoolState {
  type: BitcoinNodeType;
  nodes: NodeState[];
}

interface NodeState {
  type: BitcoinNodeType;
  isDown: boolean;
  downSince?: Date;
  restarted?: boolean;
  errors: string[];
}

type NodesState = NodePoolState[];

// --------- //
@Injectable()
export class NodeHealthObserver extends MetricObserver<NodesState> {
  protected readonly logger: DfxLogger;

  constructor(
    readonly monitoringService: MonitoringService,
    readonly loggerFactory: LoggerFactory,
    private readonly bitcoinService: BitcoinService,
    private readonly notificationService: NotificationService,
  ) {
    super(monitoringService, 'node', 'health');

    this.logger = this.loggerFactory.create(NodeHealthObserver);
  }

  init(data: NodesState) {
    // map to date objects
    data?.forEach((p) => p.nodes.forEach((n) => (n.downSince = n.downSince ? new Date(n.downSince) : undefined)));

    this.emit(data);
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.MONITORING, timeout: 360 })
  async fetch(): Promise<NodesState> {
    const previousState = this.data;

    let state = await this.getState(previousState);

    state = await this.handleErrors(state, previousState);

    this.emit(state);

    return state;
  }

  private async getState(previousState: NodesState): Promise<NodesState> {
    const errors = await this.bitcoinService.checkNodes();

    // batch errors by pool and node and get state (up/down)
    return Object.values(BitcoinNodeType).map((type) => ({
      type,
      nodes: Object.values(BitcoinNodeType)
        .map((type) => ({
          type,
          errors: errors.filter((e) => e.nodeType === type).map((e) => e.message),
        }))
        .filter((n) => this.bitcoinService.getDefaultClient(n.type))
        .map((n) => ({
          ...this.getNodeState(previousState, n.type),
          ...n,
          isDown: n.errors.length > 0,
        })),
    }));
  }

  private async handleErrors(state: NodesState, previousState: NodesState): Promise<NodesState> {
    // handle errors by pool
    for (const poolState of state) {
      // check for single node state changes
      for (const node of poolState.nodes) {
        const previousNode = this.getNodeState(previousState, poolState.type);
        await this.checkNode(node, previousNode);
      }
    }

    return state;
  }

  private async checkNode(node: NodeState, previous: NodeState) {
    // node state changed
    if (node.isDown !== (previous?.isDown ?? false)) {
      if (node.isDown) {
        node.downSince = new Date();
      } else {
        node.downSince = undefined;
        node.restarted = undefined;
      }

      if (node.errors.length > 0) {
        node.errors.forEach((error) => this.logger.error(`${error}`));
      } else {
        this.logger.info(`Node '${node.type}' is up`);
      }
    }

    // check for required restarts
    if (!node.restarted && node.downSince && Util.minutesDiff(node.downSince) > 30) {
      node.restarted = true;

      // send notification
      const message = `Restarting node ${node.type} (down since ${node.downSince})`;
      this.logger.error(message);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Node Error: Restart',
          errors: [message],
        },
      });
    }
  }

  private getPoolState(state: NodesState | undefined, type: BitcoinNodeType): NodePoolState | undefined {
    return state?.find((p) => p.type === type);
  }

  private getNodeState(state: NodesState | undefined, type: BitcoinNodeType): NodeState | undefined {
    return this.getNodeStateInPool(this.getPoolState(state, type));
  }

  private getNodeStateInPool(state: NodePoolState | undefined): NodeState | undefined {
    return state?.nodes.find((n) => n);
  }
}
