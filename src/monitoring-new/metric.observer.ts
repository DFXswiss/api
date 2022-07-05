import { NotImplementedException } from '@nestjs/common';
import { BehaviorSubject, skip } from 'rxjs';
import { MonitoringService } from './monitoring.service';

export abstract class MetricObserver<T> {
  #subsystemName: string;
  #metricName: string;

  $data = new BehaviorSubject<T>(null);

  constructor(private monitoringService: MonitoringService, subsystemName: string, metricName: string) {
    this.#subsystemName = subsystemName;
    this.#metricName = metricName;

    this.monitoringService.register(this);
  }

  abstract fetch(): Promise<T>;

  // default implementation - override in specific observers to implement custom webhook for metric
  onWebhook(data: unknown): void {
    const errorMessage = `Webhook is not supported by subsystem: '${this.subsystem}'', metric: '${this.metric}'. Ignoring incoming data`;
    console.warn(errorMessage, data);

    throw new NotImplementedException(errorMessage);
  }

  protected emit(data: T) {
    this.$data.next(data);
  }

  get subscription() {
    return this.$data.asObservable().pipe(skip(1));
  }

  get subsystem(): string {
    return this.#subsystemName;
  }

  get metric(): string {
    return this.#metricName;
  }

  get data(): T {
    return this.$data.value;
  }
}
