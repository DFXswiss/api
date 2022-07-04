import { Injectable, NotFoundException } from '@nestjs/common';
import { MetricObserver } from './metric.observer';
import { Metric, MetricName, SubsystemName, SubsystemState, SystemState } from './system-state-snapshot.entity';
import { SystemStateSnapshotRepository } from './system-state-snapshot.repository';

type SubsystemObservers = Map<MetricName, MetricObserver<unknown>>;

@Injectable()
export class MonitoringService {
  #state: SystemState;
  #observers: Map<SubsystemName, SubsystemObservers>;

  constructor(private systemStateSnapshotRepo: SystemStateSnapshotRepository) {
    this.loadState();
  }

  // *** PUBLIC API *** //

  async getState(subsystem: string, metric: string): Promise<SystemState | SubsystemState | Metric> {
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

  private async loadState() {
    const latestPreservedState = await this.systemStateSnapshotRepo.findOne();

    if (!latestPreservedState) {
      this.initState();
    }

    try {
      const state = JSON.parse(latestPreservedState.data);
      this.#state = state;
    } catch (e) {
      console.warn('Failed to parse loaded system state. Re-initializing monitoring state');
      this.initState();
    }
  }

  private initState() {
    this.#state = {};
  }

  private getSubsystemState(subsystem: string): SubsystemState {
    const _subsystem = this.#state[subsystem];

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
      this.updateSystemState.bind(this, observer.subsystem, observer.metric, data),
    );
  }

  private updateSystemState(subsystem: string, metric: string, data: unknown) {
    if (!this.#state[subsystem]) this.#state[subsystem] = {};

    const newState = { data, updated: new Date() };

    this.#state[subsystem][metric] = newState;
  }
}
