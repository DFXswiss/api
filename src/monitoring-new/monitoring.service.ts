import { Injectable, NotFoundException } from '@nestjs/common';
import { BehaviorSubject, debounceTime, skip } from 'rxjs';
import { MetricObserver } from './metric.observer';
import { Metric, MetricName, SubsystemName, SubsystemState, SystemState } from './system-state-snapshot.entity';
import { SystemStateSnapshotRepository } from './system-state-snapshot.repository';

type SubsystemObservers = Map<MetricName, MetricObserver<unknown>>;

@Injectable()
export class MonitoringService {
  #$state: BehaviorSubject<SystemState> = new BehaviorSubject({});
  #observers: Map<SubsystemName, SubsystemObservers> = new Map();

  constructor(private systemStateSnapshotRepo: SystemStateSnapshotRepository) {
    this.initState();
  }

  // *** PUBLIC API *** //

  async getState(subsystem: string, metric: string): Promise<SystemState | SubsystemState | Metric> {
    if (!subsystem && !metric) {
      return this.#$state.value;
    }

    if (subsystem && !metric) {
      return this.getSubsystemState(subsystem);
    }

    if (subsystem && metric) {
      return this.getMetric(subsystem, metric);
    }
  }

  // *** WEBHOOK *** //

  async onWebhook(subsystem: string, metric: string, data: unknown) {
    const observer = this.getMetricObserver(subsystem, metric);

    observer.onWebhook(data);
  }

  // *** OBSERVERS REGISTRATION *** //

  register(observer: MetricObserver<unknown>) {
    const subsystem = this.#observers.get(observer.subsystem) || new Map();
    const existingObserver = subsystem.get(observer.metric);

    if (existingObserver) {
      throw new Error(`Observer for metric '${observer.metric}' already exists`);
    }

    this.subscribeToUpdates(observer);
    subsystem.set(observer.metric, observer);
    this.#observers.set(observer.subsystem, subsystem);
  }

  // *** HELPER METHODS *** //

  private async initState() {
    await this.loadState();

    this.#$state.pipe(skip(1), debounceTime(1000)).subscribe((state) => this.persist(state));
  }

  private async loadState() {
    const latestPreservedState = await this.systemStateSnapshotRepo.findOne({ order: { id: 'DESC' } });

    if (!latestPreservedState) {
      return;
    }

    try {
      const state = JSON.parse(latestPreservedState.data);
      this.#$state.next(state);
    } catch (e) {
      console.warn('Failed to parse loaded system state. Defaulting to empty state', e);
    }
  }

  private async persist(state: SystemState) {
    const entity = this.systemStateSnapshotRepo.create({ data: JSON.stringify(state) });

    this.systemStateSnapshotRepo.save(entity);
  }

  private getSubsystemState(subsystem: string): SubsystemState {
    const _subsystem = this.#$state.value[subsystem];

    if (!_subsystem) {
      throw new NotFoundException(`Subsystem not found, name: ${subsystem}`);
    }
    return _subsystem;
  }

  private getMetric(subsystem: string, metric: string): Metric {
    const _subsystem = this.getSubsystemState(subsystem);
    const _metric = _subsystem[metric];

    if (!_metric) {
      throw new NotFoundException(`Metric not found, subsystem name: ${subsystem}, metric name: ${metric}`);
    }

    return _metric;
  }

  private getSubsystemObserver(subsystem: string): SubsystemObservers {
    const _subsystem = this.#observers.get(subsystem);

    if (!_subsystem) {
      throw new NotFoundException(`No observers for subsystem: ${subsystem}`);
    }
    return _subsystem;
  }

  private getMetricObserver(subsystem: string, metric: string): MetricObserver<unknown> {
    const _subsystem = this.getSubsystemObserver(subsystem);
    const _observer = _subsystem.get(metric);

    if (!_observer) {
      throw new NotFoundException(`Observer not found, subsystem name: ${subsystem}, metric name: ${metric}`);
    }

    return _observer;
  }

  private subscribeToUpdates(observer: MetricObserver<unknown>): void {
    observer.subscription.subscribe((data: unknown) =>
      this.updateSystemState.call(this, observer.subsystem, observer.metric, data),
    );
  }

  private updateSystemState(subsystem: string, metric: string, data: unknown) {
    const newSubsystemState = this.#$state.value[subsystem] ?? {};
    const newMetricState = { data, updated: new Date() };

    newSubsystemState[metric] = newMetricState;

    const newSystemState = { ...this.#$state.value, [subsystem]: newSubsystemState };

    this.#$state.next(newSystemState);
  }
}
