import { Injectable } from '@nestjs/common';
import { NodeService } from 'src/ain/node/node.service';
import { MetricObserver } from 'src/monitoring-new/metric.observer';
import { MonitoringService } from 'src/monitoring-new/monitoring.service';

export interface BankingBotData {
  fileName?: string;
  errorMessage?: string;
}

@Injectable()
export class BankingBotObserver extends MetricObserver<BankingBotData> {
  constructor(monitoringService: MonitoringService, readonly nodeService: NodeService) {
    super(monitoringService, 'bankingBot', 'uploaderLogs');
  }

  async fetch() {
    return null;
  }

  onWebhook(data: BankingBotData) {
    // list of all logs that the banking bot did
    // check if its really json format data or make one
    console.log(data);
    this.emit(data);
  }
}
