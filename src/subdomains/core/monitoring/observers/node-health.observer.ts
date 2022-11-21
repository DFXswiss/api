import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeMode } from 'src/integration/blockchain/ain/node/node-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { AzureService } from 'src/integration/infrastructure/azure-service';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';

type MailMessage = string;

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

// --------- //
@Injectable()
export class NodeHealthObserver extends MetricObserver<NodePoolState[]> {
  constructor(
    readonly monitoringService: MonitoringService,
    private readonly nodeService: NodeService,
    private readonly notificationService: NotificationService,
    private readonly azureService: AzureService,
  ) {
    super(monitoringService, 'node', 'health');
  }

  @Interval(60000)
  async fetch(): Promise<NodePoolState[]> {
    let poolStates = await this.getState();
    poolStates = await this.handleErrors(poolStates);

    this.emit(poolStates);

    return poolStates;
  }

  private async getState(): Promise<NodePoolState[]> {
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
        .map((n) => ({ ...this.getPreviousNodeState(n.type, n.mode), ...n, isDown: n.errors.length > 0 })),
    }));
  }

  private async handleErrors(poolStates: NodePoolState[]): Promise<NodePoolState[]> {
    const messages: MailMessage[] = [];

    // handle errors by pool
    for (const poolState of poolStates) {
      messages.push(...this.checkPool(poolState));

      // check for single node state changes
      for (const node of poolState.nodes) {
        messages.push(...(await this.checkNode(node)));
      }
    }

    // send notification
    if (messages.length > 0) {
      console.log(messages);

      const currentStates = poolStates
        .filter((s) => s.nodes.length > 0)
        .map((s) => `${s.type}: ${s.nodes.map((n) => (n.isDown ? 'down' : 'up')).join(' ')}`);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        input: {
          subject: 'Node Error',
          errors: ['Errors:', ...messages, '', 'Current State:', ...currentStates],
        },
      });
    }

    return poolStates;
  }

  private checkPool(poolState: NodePoolState): string[] {
    const previousPoolState = this.getPreviousPoolState(poolState.type);

    // check, if swap required
    const { value: connectedNode } = this.nodeService.connectedNodes.get(poolState.type);
    const preferredNode = poolState.nodes.find((n) => !n.isDown);

    if (!preferredNode) {
      // all available nodes down
      if (!previousPoolState || previousPoolState.nodes.some((n) => !n.isDown)) {
        return [`ALERT! Node '${poolState.type}' is fully down.`];
      }
    } else if (preferredNode.mode !== connectedNode.mode) {
      // swap required
      this.nodeService.swapNode(poolState.type, preferredNode.mode);
      return [`WARN. Node '${poolState.type}' switched from ${connectedNode.mode} to ${preferredNode.mode}`];
    }

    return [];
  }

  private async checkNode(node: NodeState): Promise<string[]> {
    const messages = [];
    const previous = this.getPreviousNodeState(node.type, node.mode);

    // node state changed
    if (node.isDown !== (previous?.isDown ?? false)) {
      if (node.isDown) {
        node.downSince = new Date();
      } else {
        node.downSince = undefined;
        node.restarted = undefined;
      }

      const errors =
        node.errors.length > 0 ? node.errors.map((e) => `ERR. ${e}`) : [`OK. Node '${node.type}' ${node.mode} is up`];
      messages.push(...errors);
    }

    // check for required restarts
    if (!node.restarted && node.downSince && Util.minutesDiff(node.downSince, new Date()) > 30) {
      const message = `ALERT! Restarting node ${node.type} ${node.mode} (down since ${node.downSince})`;
      messages.push(message);
      console.log(message);

      node.restarted = true;

      await this.azureService.restartWebApp(`node-${node.type}`, node.mode === NodeMode.PASSIVE ? 'stg' : undefined);
    }

    return messages;
  }

  private getPreviousPoolState(type: NodeType): NodePoolState | undefined {
    return this.$data.value?.find((p) => p.type === type);
  }

  private getPreviousNodeState(type: NodeType, mode: NodeMode): NodeState | undefined {
    return this.getPreviousPoolState(type)?.nodes.find((n) => n.mode === mode);
  }
}
