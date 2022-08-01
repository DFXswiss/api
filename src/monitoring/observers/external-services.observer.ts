import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { IbanService } from 'src/shared/services/iban.service';
import { LetterService } from 'src/shared/services/letter.service';

interface ExternalServicesData {
  name: string;
  balance: number;
}

@Injectable()
export class ExternalServicesObserver extends MetricObserver<ExternalServicesData[]> {
  constructor(
    monitoringService: MonitoringService,
    private readonly ibanService: IbanService,
    private readonly letterService: LetterService,
  ) {
    super(monitoringService, 'externalServices', 'balance');
  }

  @Interval(900000)
  async fetch() {
    const data = await this.getExternalServices();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getExternalServices(): Promise<ExternalServicesData[]> {
    return [await this.getIbanService(), await this.getLetterService()];
  }

  private async getIbanService(): Promise<ExternalServicesData> {
    return { name: 'Iban', balance: await this.ibanService.getBalance() };
  }

  private async getLetterService(): Promise<ExternalServicesData> {
    return { name: 'Letter', balance: await this.letterService.getBalance() };
  }
}
