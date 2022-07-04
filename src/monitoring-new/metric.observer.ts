import { BehaviorSubject } from 'rxjs';
import { MonitoringService } from './monitoring.service';

export abstract class MetricObserver<T> {
  #subsystemName: string;
  #metricName: string;

  $data = new BehaviorSubject<T>(null);

  constructor(private monitoringService: MonitoringService, subsystemName: string, metricName: string) {
    this.monitoringService.register(this);

    this.#subsystemName = subsystemName;
    this.#metricName = metricName;
  }

  abstract fetch(): Promise<T>;

  abstract compare(prevState: T, currentState: T): void;

  abstract onWebhook(data: unknown): void;

  protected emit(data: T) {
    this.$data.next(data);
  }

  get subscription() {
    return this.$data.asObservable();
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
