import { cloneDeep } from 'lodash';
import { BehaviorSubject } from 'rxjs';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeClient, NodeMode } from 'src/ain/node/node-client';
import { NodeError, NodeService, NodeType } from 'src/ain/node/node.service';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { MailService } from 'src/shared/services/mail.service';

interface NodesData {
  connectedNodes: Map<NodeType, BehaviorSubject<NodeClient | null>>;
  configuredNodes: Map<NodeType, Record<NodeMode, NodeClient | null>>;
  errors: NodeError[];
}

interface NodesHealth {
  allNodesHealthy: boolean;
  nodes: {
    [key in NodeType]: NodePairHealth;
  };
}

type NodePairHealth = {
  mails: NodePairHealthMails;
  health: {
    [key in NodeMode]: NodeHealth;
  };
};

interface NodePairHealthMails {
  bothNodesDown?: boolean;
  activeDownPassiveNotConfigured?: boolean;
  passiveDownActiveNotConfigured?: boolean;
  passiveDownActiveRemainsUp?: boolean;
}

interface NodeHealth {
  configured: boolean;
  available: boolean;
  errors: NodeError[];
}

type MailMessage = string;

@Injectable()
export class NodeHealthObserver extends MetricObserver<NodesHealth> {
  constructor(
    monitoringService: MonitoringService,
    readonly nodeService: NodeService,
    readonly mailService: MailService,
  ) {
    super(monitoringService, 'node', 'health');
  }

  @Interval(60000)
  async fetch(): Promise<NodesHealth> {
    const nodesData = await this.getNodesData();
    const monitoringData = this.generateMonitoringData(nodesData);

    this.emit(monitoringData);

    return monitoringData;
  }

  // *** HELPER METHODS *** //

  private async getNodesData(): Promise<NodesData> {
    return {
      connectedNodes: this.nodeService.connectedNodes,
      configuredNodes: this.nodeService.allNodes,
      errors: await this.nodeService.checkNodes(),
    };
  }

  private generateMonitoringData(incomingNodesData: NodesData): NodesHealth {
    const currentMonitoringData = this.$data.value || this.initMonitoringData();
    const newMonitoringData = cloneDeep(currentMonitoringData);

    this.mapConfiguredNodes(incomingNodesData, newMonitoringData);
    this.handleIncomingNodesData(incomingNodesData, currentMonitoringData, newMonitoringData);

    return newMonitoringData;
  }

  private mapConfiguredNodes(incomingNodesData: NodesData, newMonitoringData: NodesHealth): void {
    Object.values(NodeType).forEach((nodeKey) => {
      Object.values(NodeMode).forEach((modeKey) => {
        const node = incomingNodesData.configuredNodes.get(nodeKey);
        const isConfigured = !!(node && node[modeKey]);

        newMonitoringData.nodes[nodeKey].health[modeKey].configured = isConfigured;
      });
    });
  }

  private async handleIncomingNodesData(
    incomingNodesData: NodesData,
    prevState: NodesHealth,
    state: NodesHealth,
  ): Promise<void> {
    if (incomingNodesData.errors.length > 0) {
      this.updateAllNodesStatus(false, state);

      console.error(`Node errors: ${incomingNodesData.errors.map((e) => e.message)}`);
    }

    const mailMessages = this.validateConnectedNodes(incomingNodesData, prevState, state);

    if (mailMessages.length > 0) {
      await this.mailService.sendErrorMail('Node Error', [
        ...mailMessages,
        ...incomingNodesData.errors.map((e) => e.message),
      ]);
    }

    if (incomingNodesData.errors.length === 0 && !prevState.allNodesHealthy) {
      // recovered from errors in previous iteration
      await this.mailService.sendErrorMail('Node Recovered', ['INFO. All Nodes are up and running again!']);
      this.updateAllNodesStatus(true, state);

      console.log('All nodes recovered from errors');
    }
  }

  private validateConnectedNodes(
    incomingNodesData: NodesData,
    prevState: NodesHealth,
    state: NodesHealth,
  ): MailMessage[] {
    const mailMessages = [];
    const errorsByNodes = this.batchErrorsByNodes(incomingNodesData.errors);

    errorsByNodes.forEach((errors: NodeError[] = [], type: NodeType) => {
      const { value: connectedNode } = incomingNodesData.connectedNodes.get(type);

      const activeNodeError = errors.find((e) => e.mode === NodeMode.ACTIVE);
      const passiveNodeError = errors.find((e) => e.mode === NodeMode.PASSIVE);

      if (!connectedNode) {
        this.updateNodeState(type, NodeMode.ACTIVE, { available: false }, state);
        this.updateNodeState(type, NodeMode.PASSIVE, { available: false }, state);

        return;
      }

      if (errors.length === 0 && connectedNode.mode === NodeMode.ACTIVE) {
        this.updateNodeState(type, NodeMode.ACTIVE, { available: true, errors: [] }, state);

        const isPassiveConfigured = state.nodes[type].health[NodeMode.PASSIVE].configured;
        this.updateNodeState(type, NodeMode.PASSIVE, { available: isPassiveConfigured, errors: [] }, state);
        this.resetMailState(type, state);

        return;
      }

      if (errors.length === 0 && connectedNode.mode === NodeMode.PASSIVE) {
        try {
          this.updateNodeState(type, NodeMode.PASSIVE, { available: true, errors: [] }, state);

          this.nodeService.swapNode(type, NodeMode.ACTIVE);

          this.updateNodeState(type, NodeMode.ACTIVE, { available: true, errors: [] }, state);
          this.resetMailState(type, state);

          console.log(`Node ${type} active is back up and running!`);
          mailMessages.push(`OK. Node '${type}' switched back to Active, Passive remains up.`);
        } catch {}

        return;
      }

      if (activeNodeError && passiveNodeError) {
        this.updateNodeState(type, NodeMode.ACTIVE, { available: false, errors: [activeNodeError] }, state);
        this.updateNodeState(type, NodeMode.PASSIVE, { available: false, errors: [passiveNodeError] }, state);
        this.updateMailState(type, { bothNodesDown: true }, state);

        !prevState.nodes[type].mails.bothNodesDown &&
          mailMessages.push(`ALERT! Node '${type}' is fully down, both Active and Passive.`);

        return;
      }

      if (activeNodeError && connectedNode.mode === NodeMode.ACTIVE) {
        this.updateNodeState(type, NodeMode.ACTIVE, { available: false, errors: [activeNodeError] }, state);

        try {
          this.nodeService.swapNode(type, NodeMode.PASSIVE);

          this.updateNodeState(type, NodeMode.PASSIVE, { available: true, errors: [] }, state);

          mailMessages.push(`WARN. Node '${type}' switched to Passive, Active is down.`);
        } catch {
          this.updateNodeState(type, NodeMode.PASSIVE, { available: false, errors: [] }, state);
          this.updateMailState(type, { activeDownPassiveNotConfigured: true }, state);

          !prevState.nodes[type].mails.activeDownPassiveNotConfigured &&
            mailMessages.push(
              `ALERT!. Node '${type}' is fully down. Active is down, Passive is not available in the NodeClient pool`,
            );
        }

        return;
      }

      if (passiveNodeError && connectedNode.mode === NodeMode.PASSIVE) {
        this.updateNodeState(type, NodeMode.PASSIVE, { available: false, errors: [passiveNodeError] }, state);

        try {
          this.nodeService.swapNode(type, NodeMode.ACTIVE);

          this.updateNodeState(type, NodeMode.ACTIVE, { available: true, errors: [] }, state);
          mailMessages.push(`WARN. Node '${type}' switched to Active, Passive is down.`);
        } catch {
          this.updateNodeState(type, NodeMode.ACTIVE, { available: false, errors: [] }, state);
          this.updateMailState(type, { passiveDownActiveNotConfigured: true }, state);

          !prevState.nodes[type].mails.passiveDownActiveNotConfigured &&
            mailMessages.push(
              `ALERT!. Node '${type}' is fully down. Passive is down, Active is not available in the NodeClient pool`,
            );
        }

        return;
      }

      if (passiveNodeError && connectedNode.mode === NodeMode.ACTIVE) {
        this.updateNodeState(type, NodeMode.ACTIVE, { available: true, errors: [] }, state);
        this.updateNodeState(type, NodeMode.PASSIVE, { available: false, errors: [passiveNodeError] }, state);
        this.updateMailState(type, { passiveDownActiveRemainsUp: true }, state);

        !prevState.nodes[type].mails.passiveDownActiveRemainsUp &&
          mailMessages.push(`WARN. Node '${type}' Passive is down. Active remains up.`);

        return;
      }

      this.resetMailState(type, state);
    });

    return mailMessages;
  }

  private batchErrorsByNodes(errors: NodeError[]): Map<NodeType, NodeError[]> {
    const batch = new Map<NodeType, NodeError[]>();

    Object.values(NodeType).forEach((type) => batch.set(type, []));

    errors.forEach((error) => {
      const existingErrors = batch.get(error.nodeType) ?? [];
      batch.set(error.nodeType, [...existingErrors, error]);
    });

    return batch;
  }

  private updateNodeState(node: NodeType, mode: NodeMode, update: Partial<NodeHealth>, state: NodesHealth): void {
    state.nodes[node].health[mode] = {
      ...state.nodes[node].health[mode],
      ...update,
    };
  }

  private updateMailState(node: NodeType, mails: NodePairHealthMails, state: NodesHealth): void {
    state.nodes[node].mails = {
      ...state.nodes[node].mails,
      ...mails,
    };
  }

  private resetMailState(node: NodeType, state: NodesHealth): void {
    state.nodes[node].mails = {
      bothNodesDown: undefined,
      activeDownPassiveNotConfigured: undefined,
      passiveDownActiveNotConfigured: undefined,
      passiveDownActiveRemainsUp: undefined,
    };
  }

  private updateAllNodesStatus(allNodesHealthy: boolean, data: NodesHealth): void {
    data.allNodesHealthy = allNodesHealthy;
  }

  private initMonitoringData(): NodesHealth {
    return {
      allNodesHealthy: true,
      nodes: {
        [NodeType.INPUT]: this.initNodePairHealthData(),
        [NodeType.DEX]: this.initNodePairHealthData(),
        [NodeType.OUTPUT]: this.initNodePairHealthData(),
        [NodeType.REF]: this.initNodePairHealthData(),
        [NodeType.INT]: this.initNodePairHealthData(),
      },
    };
  }

  private initNodePairHealthData(): NodePairHealth {
    return {
      mails: {},
      health: {
        [NodeMode.ACTIVE]: this.initNodeHealthData(),
        [NodeMode.PASSIVE]: this.initNodeHealthData(),
      },
    };
  }

  private initNodeHealthData(): NodeHealth {
    return {
      configured: undefined,
      available: undefined,
      errors: [],
    };
  }
}
