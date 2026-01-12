import { NotImplementedException } from '@nestjs/common';
import { BehaviorSubject, Observable, skip } from 'rxjs';
import { MonitoringService } from './monitoring.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export abstract class MetricObserver<T> {
  protected abstract readonly logger: DfxLogger;

  #subsystemName: string;
  #metricName: string;

  protected $data = new BehaviorSubject<T>(null);

  constructor(
    protected monitoringService: MonitoringService,
    subsystemName: string,
    metricName: string,
  ) {
    this.#subsystemName = subsystemName;
    this.#metricName = metricName;

    this.monitoringService.register(this);
  }

  // default implementation - override in specific observers to implement custom data init for metric
  init(_data: T) {
    // ignore on default
  }

  // default implementation - override in specific observers to implement custom fetch mechanism for metric
  fetch(): Promise<T> {
    const errorMessage = `Fetch method is not supported by subsystem '${this.subsystem}', metric '${this.metric}'`;
    this.logger.warn(errorMessage);

    throw new NotImplementedException(errorMessage);
  }

  // default implementation - override in specific observers to implement custom webhook for metric
  async onWebhook(data: unknown): Promise<void> {
    const errorMessage = `Webhook is not supported by subsystem '${this.subsystem}', metric '${this.metric}'. Ignoring incoming data: ${data}`;
    this.logger.warn(errorMessage);

    throw new NotImplementedException(errorMessage);
  }

  protected load(): Promise<T> {
    return this.monitoringService.loadStateFor<T>(this.subsystem, this.metric);
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
