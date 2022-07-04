import { Injectable, NotImplementedException } from '@nestjs/common';
import { MetricObserver } from 'src/monitoring-new/metric.observer';
import { MonitoringService } from 'src/monitoring-new/monitoring.service';
import { MailService } from 'src/shared/services/mail.service';

export interface StuckBatches {
  stuckBatchesCount: number;
}

@Injectable()
export class StuckBatchesObserver extends MetricObserver<StuckBatches> {
  constructor(monitoringService: MonitoringService, private mailService: MailService) {
    super(monitoringService, 'buy-crypto', 'stuck-batches');
  }

  async fetch() {
    const data = await this.getStuckBatches();

    this.compare(this.data, data);
    this.emit(data);

    return data;
  }

  onWebhook() {
    throw new NotImplementedException('Webhook is not supported by this metric. Ignoring incoming data');
  }

  async compare(prevState: StuckBatches, currState: StuckBatches) {
    if (currState.stuckBatchesCount > prevState.stuckBatchesCount) {
      // send mail - new batches got stuck.
      // any actions fo here
    }
  }

  // *** HELPER METHODS *** //

  private async getStuckBatches(): Promise<StuckBatches> {
    return { stuckBatchesCount: 4 };
  }
}
