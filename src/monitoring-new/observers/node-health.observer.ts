import { cloneDeep } from 'lodash';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { BehaviorSubject } from 'rxjs';
import { NodeClient, NodeMode } from 'src/ain/node/node-client';
import { NodeError, NodeService, NodeType } from 'src/ain/node/node.service';
import { MetricObserver } from 'src/monitoring-new/metric.observer';
import { MonitoringService } from 'src/monitoring-new/monitoring.service';
import { MailService } from 'src/shared/services/mail.service';

interface NodesData {
  connectedNodes: Map<NodeType, BehaviorSubject<NodeClient | null>>;
  errors: NodeError[];
}

interface NodesHealth {
  allNodesHealthy: boolean;
  nodes: {
    [key in NodeType]: NodePairHealth;
  };
}

type NodePairHealth = {
  mails: {
    bothNodesDown?: boolean;
    activeDownPassiveNotConfigured?: boolean;
    passiveDownActiveNotConfigured?: boolean;
    passiveDownActiveRemainsUp?: boolean;
  };
  health: {
    [key in NodeMode]: NodeHealth;
  };
};

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
    super(monitoringService, 'node', 'nodeHealth');
  }

  @Interval(60000)
  async fetch() {
    const nodesData = await this.getNodesData();
    const monitoringData = this.generateMonitoringData(nodesData);

    this.emit(monitoringData);

    return monitoringData;
  }

  // *** HELPER METHODS *** //

  private async getNodesData(): Promise<NodesData> {
    return {
      connectedNodes: this.nodeService.connectedNodes,
      errors: await this.nodeService.checkNodes(),
    };
  }

  private generateMonitoringData(incomingNodesData: NodesData): NodesHealth {
    const currentMonitoringData = this.$data.value || this.initMonitoringData();
    const newMonitoringData = cloneDeep(currentMonitoringData);

    this.handleIncomingNodesData(incomingNodesData, currentMonitoringData, newMonitoringData);

    return newMonitoringData;
  }

  private async handleIncomingNodesData(
    incomingNodesData: NodesData,
    currentMonitoringData: NodesHealth,
    newMonitoringData: NodesHealth,
  ): Promise<void> {
    if (incomingNodesData.errors.length > 0) {
      newMonitoringData.allNodesHealthy = false;

      console.error(`Node errors: ${incomingNodesData.errors.map((e) => e.message)}`);
    }

    const mailMessages = this.validateConnectedNodes(incomingNodesData, currentMonitoringData, newMonitoringData);

    if (mailMessages.length > 0) {
      await this.mailService.sendErrorMail('Node Error', [
        ...mailMessages,
        ...incomingNodesData.errors.map((e) => e.message),
      ]);
    }

    if (incomingNodesData.errors.length === 0 && !currentMonitoringData.allNodesHealthy) {
      // recovered from errors in previous iteration
      await this.mailService.sendErrorMail('Node Recovered', ['INFO. All Nodes are up and running again!']);
      newMonitoringData.allNodesHealthy = true;

      console.log('All nodes recovered from errors');
    }
  }

  private validateConnectedNodes(
    incomingNodesData: NodesData,
    currentMonitoringData: NodesHealth,
    newMonitoringData: NodesHealth,
  ): MailMessage[] {
    const mailMessages = [];
    const errorsByNodes = this.batchErrorsByNodes(incomingNodesData.errors);

    errorsByNodes.forEach((errors: NodeError[] = [], type: NodeType) => {
      const { value: connectedNode } = incomingNodesData.connectedNodes.get(type);

      const activeNodeError = errors.find((e) => e.mode === NodeMode.ACTIVE);
      const passiveNodeError = errors.find((e) => e.mode === NodeMode.PASSIVE);

      if (!connectedNode) {
        newMonitoringData.nodes[type] = {
          mails: { ...currentMonitoringData.nodes[type].mails },
          health: {
            [NodeMode.ACTIVE]: {
              configured: false,
              available: false,
              errors: [],
            },
            [NodeMode.PASSIVE]: {
              configured: false,
              available: false,
              errors: [],
            },
          },
        };

        return;
      }

      if (errors.length === 0 && connectedNode.mode === NodeMode.ACTIVE) {
        newMonitoringData.nodes[type] = {
          mails: { ...currentMonitoringData.nodes[type].mails },
          health: {
            [NodeMode.ACTIVE]: {
              configured: true,
              available: true,
              errors: [],
            },
            [NodeMode.PASSIVE]: {
              configured: false,
              available: false,
              errors: [],
            },
          },
        };

        return;
      }

      if (errors.length === 0 && connectedNode.mode === NodeMode.PASSIVE) {
        newMonitoringData.nodes[type] = {
          mails: { ...currentMonitoringData.nodes[type].mails },
          health: {
            [NodeMode.ACTIVE]: {
              configured: true,
              available: true,
              errors: [],
            },
            [NodeMode.PASSIVE]: {
              configured: true,
              available: true,
              errors: [],
            },
          },
        };

        try {
          this.nodeService.swapNode(type, NodeMode.ACTIVE);

          console.log(`Node ${type} active is back up and running!`);
          mailMessages.push(`OK. Node '${type}' switched back to Active, Passive remains up.`);
        } catch {}

        return;
      }

      if (activeNodeError && passiveNodeError) {
        newMonitoringData.nodes[type] = {
          mails: {
            ...currentMonitoringData.nodes[type].mails,
            bothNodesDown: true,
          },
          health: {
            [NodeMode.ACTIVE]: {
              configured: true,
              available: false,
              errors: [activeNodeError],
            },
            [NodeMode.PASSIVE]: {
              configured: true,
              available: false,
              errors: [passiveNodeError],
            },
          },
        };

        !currentMonitoringData.nodes[type].mails.bothNodesDown &&
          mailMessages.push(`ALERT! Node '${type}' is fully down, both Active and Passive.`);

        return;
      }

      if (activeNodeError && connectedNode.mode === NodeMode.ACTIVE) {
        try {
          newMonitoringData.nodes[type] = {
            mails: { ...currentMonitoringData.nodes[type].mails },
            health: {
              [NodeMode.ACTIVE]: {
                configured: true,
                available: false,
                errors: [activeNodeError],
              },
              [NodeMode.PASSIVE]: {
                configured: true,
                available: true,
                errors: [],
              },
            },
          };

          this.nodeService.swapNode(type, NodeMode.PASSIVE);
          mailMessages.push(`WARN. Node '${type}' switched to Passive, Active is down.`);
        } catch {
          newMonitoringData.nodes[type] = {
            mails: {
              ...currentMonitoringData.nodes[type].mails,
              activeDownPassiveNotConfigured: true,
            },
            health: {
              [NodeMode.ACTIVE]: {
                configured: true,
                available: false,
                errors: [activeNodeError],
              },
              [NodeMode.PASSIVE]: {
                configured: false,
                available: false,
                errors: [],
              },
            },
          };

          !currentMonitoringData.nodes[type].mails.activeDownPassiveNotConfigured &&
            mailMessages.push(
              `ALERT!. Node '${type}' is fully down. Active is down, Passive is not available in the NodeClient pool`,
            );
        }

        return;
      }

      if (passiveNodeError && connectedNode?.mode === NodeMode.PASSIVE) {
        try {
          newMonitoringData.nodes[type] = {
            mails: { ...currentMonitoringData.nodes[type].mails },
            health: {
              [NodeMode.ACTIVE]: {
                configured: true,
                available: true,
                errors: [],
              },
              [NodeMode.PASSIVE]: {
                configured: true,
                available: false,
                errors: [passiveNodeError],
              },
            },
          };

          this.nodeService.swapNode(type, NodeMode.ACTIVE);
          mailMessages.push(`WARN. Node '${type}' switched to Active, Passive is down.`);
        } catch {
          newMonitoringData.nodes[type] = {
            mails: {
              ...currentMonitoringData.nodes[type].mails,
              passiveDownActiveNotConfigured: true,
            },
            health: {
              [NodeMode.ACTIVE]: {
                configured: true,
                available: true,
                errors: [],
              },
              [NodeMode.PASSIVE]: {
                configured: true,
                available: false,
                errors: [passiveNodeError],
              },
            },
          };

          !currentMonitoringData.nodes[type].mails.passiveDownActiveNotConfigured &&
            mailMessages.push(
              `ALERT!. Node '${type}' is fully down. Passive is down, Active is not available in the NodeClient pool`,
            );
        }

        return;
      }

      if (passiveNodeError && connectedNode?.mode === NodeMode.ACTIVE) {
        newMonitoringData.nodes[type] = {
          mails: {
            ...currentMonitoringData.nodes[type].mails,
            passiveDownActiveRemainsUp: true,
          },
          health: {
            [NodeMode.ACTIVE]: {
              configured: true,
              available: true,
              errors: [],
            },
            [NodeMode.PASSIVE]: {
              configured: true,
              available: false,
              errors: [passiveNodeError],
            },
          },
        };
        !currentMonitoringData.nodes[type].mails.passiveDownActiveRemainsUp &&
          mailMessages.push(`WARN. Node '${type}' Passive is down. Active remains up.`);

        return;
      }
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

  private initMonitoringData(): NodesHealth {
    return {
      allNodesHealthy: true,
      nodes: {
        [NodeType.INPUT]: {
          mails: {},
          health: {
            [NodeMode.ACTIVE]: {} as NodeHealth,
            [NodeMode.PASSIVE]: {} as NodeHealth,
          },
        },
        [NodeType.DEX]: {
          mails: {},
          health: {
            [NodeMode.ACTIVE]: {} as NodeHealth,
            [NodeMode.PASSIVE]: {} as NodeHealth,
          },
        },
        [NodeType.OUTPUT]: {
          mails: {},
          health: {
            [NodeMode.ACTIVE]: {} as NodeHealth,
            [NodeMode.PASSIVE]: {} as NodeHealth,
          },
        },
        [NodeType.REF]: {
          mails: {},
          health: {
            [NodeMode.ACTIVE]: {} as NodeHealth,
            [NodeMode.PASSIVE]: {} as NodeHealth,
          },
        },
        [NodeType.INT]: {
          mails: {},
          health: {
            [NodeMode.ACTIVE]: {} as NodeHealth,
            [NodeMode.PASSIVE]: {} as NodeHealth,
          },
        },
      },
    };
  }
}
