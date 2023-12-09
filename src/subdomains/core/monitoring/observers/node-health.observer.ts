import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodeMode } from 'src/integration/blockchain/ain/node/node-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { AzureService } from 'src/integration/infrastructure/azure-service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process, ProcessService } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';

interface NodePoolState {
  type: NodeType;
  nodes: NodeState[];
}

interface NodeState {
  type: NodeType;
  mode: NodeMode;
  isDown: boolean;
  downSince?: Date;
  restarted?: boolean;
  errors: string[];
}

type NodesState = NodePoolState[];

// --------- //
@Injectable()
export class NodeHealthObserver extends MetricObserver<NodesState> {
  protected readonly logger = new DfxLogger(NodeHealthObserver);

  constructor(
    readonly monitoringService: MonitoringService,
    private readonly nodeService: NodeService,
    private readonly notificationService: NotificationService,
    private readonly azureService: AzureService,
    private readonly processService: ProcessService,
  ) {
    super(monitoringService, 'node', 'health');
  }

  init(data: NodesState) {
    // map to date objects
    data?.forEach((p) => p.nodes.forEach((n) => (n.downSince = n.downSince ? new Date(n.downSince) : undefined)));

    this.emit(data);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(360)
  async fetch(): Promise<NodesState> {
    if (await this.processService.isDisableProcess(Process.MONITORING)) return;
    const previousState = this.data;

    let state = await this.getState(previousState);

    state = await this.handleErrors(state, previousState);

    this.emit(state);

    return state;
  }

  private async getState(previousState: NodesState): Promise<NodesState> {
    const errors = await this.nodeService.checkNodes();

    // batch errors by pool and node and get state (up/down)
    return Object.values(NodeType).map((type) => ({
      type,
      nodes: Object.values(NodeMode)
        .map((mode) => ({
          type,
          mode,
          errors: errors.filter((e) => e.nodeType === type && e.mode === mode).map((e) => e.message),
        }))
        .filter((n) => this.nodeService.allNodes.get(n.type)?.[n.mode])
        .map((n) => ({
          ...this.getNodeState(previousState, n.type, n.mode),
          ...n,
          isDown: n.errors.length > 0,
        })),
    }));
  }

  private async handleErrors(state: NodesState, previousState: NodesState): Promise<NodesState> {
    // handle errors by pool
    for (const poolState of state) {
      const previousPoolState = this.getPoolState(previousState, poolState.type);

      this.checkPool(poolState, previousPoolState);

      // check for single node state changes
      for (const node of poolState.nodes) {
        const previousNode = this.getNodeState(previousState, poolState.type, node.mode);
        await this.checkNode(node, previousNode);
      }
    }

    return state;
  }

  private checkPool(poolState: NodePoolState, previousPoolState: NodePoolState) {
    // check, if swap required
    const { value: connectedNode } = this.nodeService.connectedNodes.get(poolState.type);
    const preferredNode = poolState.nodes.find((n) => !n.isDown);

    if (!preferredNode) {
      // all available nodes down
      if (!previousPoolState || previousPoolState.nodes.some((n) => !n.isDown)) {
        this.logger.critical(`Node '${poolState.type}' is fully down`);
      }
    } else if (preferredNode.mode !== connectedNode.mode) {
      // swap required
      this.nodeService.swapNode(poolState.type, preferredNode.mode);
      this.logger.warn(`Node '${poolState.type}' switched from ${connectedNode.mode} to ${preferredNode.mode}`);

      // clear the queue if node is down
      const connectedState = this.getNodeStateInPool(poolState, connectedNode.mode);
      if (connectedState.isDown) {
        connectedNode.clearRequestQueue();
      }
    }
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
        this.logger.info(`Node '${node.type}' ${node.mode} is up`);
      }
    }

    // check for required restarts
    if (!node.restarted && node.downSince && Util.minutesDiff(node.downSince, new Date()) > 30) {
      node.restarted = true;

      await this.azureService.restartWebApp(`node-${node.type}`, node.mode === NodeMode.PASSIVE ? 'stg' : undefined);

      // send notification
      const message = `Restarting node ${node.type} ${node.mode} (down since ${node.downSince})`;
      this.logger.error(message);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        input: {
          subject: 'Node Error: Restart',
          errors: [message],
        },
      });
    }
  }

  private getPoolState(state: NodesState | undefined, type: NodeType): NodePoolState | undefined {
    return state?.find((p) => p.type === type);
  }

  private getNodeState(state: NodesState | undefined, type: NodeType, mode: NodeMode): NodeState | undefined {
    return this.getNodeStateInPool(this.getPoolState(state, type), mode);
  }

  private getNodeStateInPool(state: NodePoolState | undefined, mode: NodeMode): NodeState | undefined {
    return state?.nodes.find((n) => n.mode === mode);
  }
}
