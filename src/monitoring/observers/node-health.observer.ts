import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeMode } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { MailService } from 'src/shared/services/mail.service';

type MailMessage = string;

interface NodePoolState {
  type: NodeType;
  nodes: NodeState[];
}

interface NodeState {
  type: NodeType;
  mode: NodeMode;
  isDown: boolean;
  errors: string[];
}

// --------- //
@Injectable()
export class NodeHealthObserver extends MetricObserver<NodePoolState[]> {
  constructor(
    monitoringService: MonitoringService,
    readonly nodeService: NodeService,
    readonly mailService: MailService,
  ) {
    super(monitoringService, 'node', 'health');
  }

  @Interval(60000)
  async fetch(): Promise<NodePoolState[]> {
    const poolStates = await this.getState();
    await this.handleErrors(poolStates);

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
        .map((n) => ({ ...n, isDown: n.errors.length > 0 })),
    }));
  }

  private async handleErrors(poolStates: NodePoolState[]): Promise<void> {
    const messages: MailMessage[] = [];

    // handle errors by pool
    for (const poolState of poolStates) {
      const previousPoolState = this.$data.value?.find((p) => p.type === poolState.type);

      // check, if swap required
      const { value: connectedNode } = this.nodeService.connectedNodes.get(poolState.type);
      const preferredNode = poolState.nodes.find((n) => !n.isDown);

      if (!preferredNode) {
        // all available nodes down
        if (!previousPoolState || previousPoolState.nodes.some((n) => !n.isDown)) {
          messages.push(`ALERT! Node '${poolState.type}' is fully down.`);
        }
      } else if (preferredNode.mode !== connectedNode.mode) {
        // swap required
        this.nodeService.swapNode(poolState.type, preferredNode.mode);
        messages.push(`WARN. Node '${poolState.type}' switched from ${connectedNode.mode} to ${preferredNode.mode}`);
      }

      // check for single node state changes
      for (const node of poolState.nodes) {
        const previous = previousPoolState?.nodes.find((pn) => pn.mode === node.mode);
        if (node.isDown !== (previous?.isDown ?? false)) {
          // node state changed
          const errors =
            node.errors.length > 0
              ? node.errors.map((e) => `ERR. ${e}`)
              : [`OK. Node '${node.type}' ${node.mode} is up`];
          messages.push(...errors);
        }
      }
    }

    // send the mail
    if (messages.length > 0) {
      console.log(messages);

      await this.mailService.sendErrorMail('Node Error', messages);
    }
  }
}
