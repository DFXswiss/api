import { NotImplementedException } from '@nestjs/common';
import { BehaviorSubject, Observable, skip } from 'rxjs';
import { MonitoringService } from './monitoring.service';

export abstract class MetricObserver<T> {
  #subsystemName: string;
  #metricName: string;

  protected $data = new BehaviorSubject<T>(null);

  constructor(protected monitoringService: MonitoringService, subsystemName: string, metricName: string) {
    this.#subsystemName = subsystemName;
    this.#metricName = metricName;

    this.monitoringService.register(this);
  }

  // default implementation - override in specific observers to implement custom fetch mechanism for metric
  fetch(): Promise<T> {
    const errorMessage = `Fetch method is not supported by subsystem: '${this.subsystem}'', metric: '${this.metric}'`;
    console.warn(errorMessage);

    throw new NotImplementedException(errorMessage);
  }

  // default implementation - override in specific observers to implement custom webhook for metric
  onWebhook(data: unknown): void {
    const errorMessage = `Webhook is not supported by subsystem: '${this.subsystem}'', metric: '${this.metric}'. Ignoring incoming data`;
    console.warn(errorMessage, data);

    throw new NotImplementedException(errorMessage);
  }

  protected emit(data: T): void {
    this.$data.next(data);
  }

  get $subscription(): Observable<T> {
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
