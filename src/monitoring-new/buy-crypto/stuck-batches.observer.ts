import { Injectable } from '@nestjs/common';
import { MetricObserver } from 'src/monitoring-new/metric-observer';
import { MonitoringService } from '../monitoring.service';

export interface StuckBatches {
  stuckBatchesCount: number;
}

@Injectable()
export class StuckBatchesObserver extends MetricObserver<StuckBatches> {
  constructor(monitoringService: MonitoringService) {
    super(monitoringService, 'buy-crypto', 'stuck-batches');
  }

  async fetch() {
    const data = await this.getStuckBatches();

    this.emit(data);

    return data;
  }

  onWebhook(data: unknown) {
    throw new Error('Webhook is not supported by this metric. Ignoring data: ');
  }

  async compare(prevState: StuckBatches, currState: StuckBatches) {
    if (currState.stuckBatchesCount > prevState.stuckBatchesCount) {
      // send mail - new batches got stuck.
      // any actions fo here
    }
  }

  private async getStuckBatches(): Promise<StuckBatches> {
    return { stuckBatchesCount: 4 };
  }
}
