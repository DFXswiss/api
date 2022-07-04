import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { MetricObserver } from './metric-observer';
import { Metric, MetricName, MetricUpdateStatus, SubsystemName, SubsystemState, SystemState } from './system-state';
import { SystemStateRepository } from './system-state.repository';

type SubsystemObservers = Map<MetricName, MetricObserver<unknown>>;

@Injectable()
export class MonitoringService {
  #state: SystemState;
  #observers: Map<SubsystemName, SubsystemObservers>;

  constructor(private systemStateRepo: SystemStateRepository) {}

  // *** PUBLIC API *** //

  async getState(subsystem: string, metric: string, refresh: boolean): Promise<any> {
    if (!refresh) {
      return this.getCurrentState(subsystem, metric);
    }

    return await this.getLatestState(subsystem, metric);
  }

  async getStateHistory(subsystem: string, metric: string, from: Date, to: Date): Promise<any> {
    // TBD - take from memory cache or persistence
  }

  subscribe(subsystem: string, metric: string): Observable<unknown> {
    const _subsystem = this.#observers.get(subsystem);
    const _metric = _subsystem.get(metric);

    return _metric.subscription;
  }

  // *** WEBHOOK *** //

  async recordData(subsystem: string, metric: string, data: unknown) {}

  // *** OBSERVERS REGISTRATION *** //

  register(observer: MetricObserver<unknown>) {
    const subsystem = this.#observers.get(observer.subsystem) || new Map();
    const existingObserver = subsystem.get(observer.metric);

    if (existingObserver) {
      throw new Error('Observer for metric XYZ already exists');
    }

    this.subscribeToUpdates(observer);
    subsystem.set(observer.metric, observer);
    this.#observers.set(observer.subsystem, subsystem);
  }

  // *** PERSISTENCE *** //

  private async persist() {
    // save state to the database
    // some of it to be cached in memory
  }

  // *** HELPER METHODS *** //

  private getCurrentState(subsystem: string, metric: string): SystemState | SubsystemState | Metric<unknown> {
    if (!subsystem && !metric) {
      return this.#state;
    }

    if (subsystem && !metric) {
      return this.getSubsystemState(subsystem);
    }

    if (subsystem && metric) {
      return this.getMetric(subsystem, metric);
    }
  }

  private getSubsystemState(subsystem: string): SubsystemState {
    const _subsystem = this.#state[subsystem];

    if (!_subsystem) {
      throw new Error('Subsystem not found');
    }
    return _subsystem;
  }

  private getMetric(subsystem: string, metric: string): Metric<unknown> {
    const _subsystem = this.getSubsystemState(subsystem);
    const _metric = _subsystem[metric];

    if (!_metric) {
      throw new Error('Metric not found');
    }

    return _metric;
  }

  private async getLatestState(
    subsystem: string,
    metric: string,
  ): Promise<SystemState | SubsystemState | Metric<unknown>> {
    return null;
  }

  private subscribeToUpdates(observer: MetricObserver<unknown>): void {
    observer.subscription.subscribe((data: unknown) => {
      this.#state[observer.subsystem][observer.metric].data = data;
      this.#state[observer.subsystem][observer.metric].updated = new Date();
      this.#state[observer.subsystem][observer.metric].status = MetricUpdateStatus.AVAILABLE;
    });
  }
}
