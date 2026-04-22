import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { BitcoinService } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';

interface NodeState {
  isDown: boolean;
  downSince?: Date;
  restarted?: boolean;
  errors: string[];
}

// --------- //
@Injectable()
export class NodeHealthObserver extends MetricObserver<NodeState> {
  protected readonly logger = new DfxLogger(NodeHealthObserver);

  constructor(
    readonly monitoringService: MonitoringService,
    private readonly bitcoinService: BitcoinService,
    private readonly notificationService: NotificationService,
  ) {
    super(monitoringService, 'node', 'health');
  }

  init(data: NodeState) {
    if (data) {
      data.downSince = data.downSince ? new Date(data.downSince) : undefined;
    }

    this.emit(data);
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.MONITORING, timeout: 360 })
  async fetch(): Promise<NodeState> {
    const previousState = this.data;

    const state = await this.getState(previousState);

    await this.checkNode(state, previousState);

    this.emit(state);

    return state;
  }

  private async getState(previousState: NodeState | undefined): Promise<NodeState> {
    const errors = await this.bitcoinService.checkNodes();

    return {
      ...previousState,
      errors: errors.map((e) => e.message),
      isDown: errors.length > 0,
    };
  }

  private async checkNode(node: NodeState, previous: NodeState | undefined) {
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
        this.logger.info('Bitcoin node is up');
      }
    }

    // check for required restarts
    if (!node.restarted && node.downSince && Util.minutesDiff(node.downSince) > 30) {
      node.restarted = true;

      // send notification
      const message = `Restarting Bitcoin node (down since ${node.downSince})`;
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
}
