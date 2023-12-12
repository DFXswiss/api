import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IbanService } from 'src/integration/bank/services/iban.service';
import { LetterService } from 'src/integration/letter/letter.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';

interface ExternalServicesData {
  name: string;
  balance: number;
  status: Status;
}

enum Status {
  ONLINE = 'Online',
  OFFLINE = 'Offline',
}

@Injectable()
export class ExternalServicesObserver extends MetricObserver<ExternalServicesData[]> {
  protected readonly logger = new DfxLogger(ExternalServicesObserver);

  constructor(
    monitoringService: MonitoringService,
    private readonly ibanService: IbanService,
    private readonly letterService: LetterService,
  ) {
    super(monitoringService, 'externalServices', 'combined');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock(1800)
  async fetch() {
    if (DisabledProcess(Process.MONITORING)) return;

    const data = await this.getExternalServices();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getExternalServices(): Promise<ExternalServicesData[]> {
    return [await this.getIbanService(), await this.getLetterService()];
  }

  private async getIbanService(): Promise<ExternalServicesData> {
    const balance = await this.ibanService.getBalance();
    return { name: 'IBAN', balance, status: balance ? Status.ONLINE : Status.OFFLINE };
  }

  private async getLetterService(): Promise<ExternalServicesData> {
    const balance = await this.letterService.getBalance();
    return { name: 'Letter', balance, status: balance ? Status.ONLINE : Status.OFFLINE };
  }
}
