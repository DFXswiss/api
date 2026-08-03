import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { cloneDeep, isEqual } from 'lodash';
import { BehaviorSubject, debounceTime, pairwise } from 'rxjs';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MetricObserver } from './metric.observer';
import {
  Metric,
  MetricName,
  SubsystemName,
  SubsystemState,
  SystemState,
  SystemStateSnapshot,
} from './system-state-snapshot.entity';
import { SystemStateSnapshotRepository } from './system-state-snapshot.repository';

type SubsystemObservers = Map<MetricName, MetricObserver<unknown>>;

@Injectable()
export class MonitoringService implements OnModuleInit {
  private static readonly stateCacheMs = 30 * 1000;

  /**
   * Postgres: unique violation, deadlock, serialization failure - all resolvable by trying again.
   * Read from `code` on the error, the same way LedgerAccountService reads a unique violation.
   */
  private static readonly retryableWriteCodes = ['23505', '40P01', '40001'];

  private readonly logger = new DfxLogger(MonitoringService);

  #$state: BehaviorSubject<SystemState> = new BehaviorSubject({});
  #observers: Map<SubsystemName, SubsystemObservers> = new Map();
  #storedState?: { state: SystemState; loaded: number };
  #pendingLoad?: Promise<SystemState | null>;

  constructor(
    private systemStateSnapshotRepo: SystemStateSnapshotRepository,
    readonly notificationService: NotificationService,
  ) {}

  onModuleInit() {
    void this.initState();
  }

  // *** PUBLIC API *** //

  async getState(subsystem: string, metric: string): Promise<SystemState | SubsystemState | Metric> {
    // Reading the in-memory state alone would only be correct in the process running the
    // observers. The state is already persisted in full, so every read path takes it from there,
    // with a short process cache in front. The refresh happens before the branching, not inside
    // one of the branches: a filtered query is the same read and would otherwise stay stale.
    const state = await this.currentState();

    if (!subsystem && !metric) {
      return state;
    }

    if (subsystem && !metric) {
      return this.getSubsystemState(state, subsystem);
    }

    if (subsystem && metric) {
      return this.getMetric(state, subsystem, metric);
    }
  }

  async loadState(): Promise<SystemState | null> {
    try {
      return await this.readState();
    } catch (e) {
      this.logger.error('Failed to parse loaded system state, defaulting to empty state:', e);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: { subject: 'Monitoring Error. Failed to parse loaded system state.', errors: [e] },
      });

      return null;
    }
  }

  async loadStateFor<T>(subsystem: string, metric: string): Promise<T | undefined> {
    const state = await this.loadState();
    return state?.[subsystem]?.[metric]?.data as T;
  }

  // *** WEBHOOK *** //

  async onWebhook(subsystem: string, metric: string, data: unknown) {
    const observer = this.getMetricObserver(subsystem, metric);

    // caution - keep await to catch possible exception in controller stack
    await observer.onWebhook(data);
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

  // *** HELPER METHODS *** /

  private async initState() {
    const state = await this.loadState();

    if (state) {
      this.#$state.next(state);

      // init observers
      for (const [subsystem, metrics] of Object.entries(state)) {
        for (const [metric, { data }] of Object.entries(metrics)) {
          try {
            const observer = this.getMetricObserver(subsystem, metric);
            observer.init(data);
          } catch {
            // ignore - metric initialization may fail
          }
        }
      }
    }

    this.#$state
      .pipe(debounceTime(2000), pairwise())
      .subscribe(([prevState, newState]) => this.persist(prevState, newState));
  }

  /**
   * Writes only the metrics this process changed, merged into the stored state.
   *
   * The whole system state lives in a single row (`id: 1`), and `initState` above subscribes
   * this writer in whichever process the service is instantiated in. Replacing the row with this
   * instance's view would drop metrics another writer put there; merging only the changed ones
   * keeps both.
   *
   * Read, merge and write happen inside one transaction that locks the row. Without the lock the
   * merge only narrows the race instead of closing it: two writers that read before either wrote
   * still overwrite each other, and the lost value does not come back on its own - the next run
   * compares against this process's own previous state, finds the metric unchanged, and writes
   * nothing. A value that rarely changes would stay wrong in the row until it does.
   */
  private async persist(prevState: SystemState, newState: SystemState) {
    try {
      const changed = this.changedMetrics(prevState, newState);
      if (!changed.length) return;

      // A second attempt covers the case where the row does not exist yet: it cannot be locked,
      // so two writers can reach the insert together and one loses on the primary key. Retrying
      // finds the row the other one created and merges into it, instead of dropping this
      // process's change until the metric happens to change again. Restricted to the errors that
      // a retry can actually resolve - a unique violation, a deadlock or a serialization failure.
      // Anything else fails once and is reported.
      const merged = await Util.retry(
        () => this.mergeIntoStoredState(changed, newState),
        2,
        0,
        undefined,
        (e) => MonitoringService.retryableWriteCodes.includes((e as { code?: string })?.code),
      );

      this.#storedState = { state: merged, loaded: Date.now() };
    } catch (e) {
      this.logger.error('Error persisting the state:', e);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: { subject: 'Monitoring Error. Error persisting the state.', errors: [e] },
      });
    }
  }

  private async mergeIntoStoredState(changed: [string, string][], newState: SystemState): Promise<SystemState> {
    return this.systemStateSnapshotRepo.manager.transaction(async (manager) => {
      const row = await manager.findOne(SystemStateSnapshot, {
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      });

      const stored: SystemState = row ? JSON.parse(row.data) : {};
      const state = cloneDeep(stored);

      for (const [subsystem, metric] of changed) {
        const candidate = newState[subsystem][metric];

        // The value this process holds is not automatically the newer one: it may have waited on
        // the lock while another process wrote a later measurement of the same metric. Writing it
        // anyway would put the older value back, and it would stay there until the metric changes
        // again in this process.
        if (this.updatedAt(candidate) < this.updatedAt(state[subsystem]?.[metric])) continue;

        state[subsystem] = { ...(state[subsystem] ?? {}), [metric]: candidate };
      }

      await manager.save(SystemStateSnapshot, { id: 1, data: JSON.stringify(state) });

      return state;
    });
  }

  /** The metrics whose data differs between the two states, as [subsystem, metric] pairs. */
  private changedMetrics(prevState: SystemState, newState: SystemState): [string, string][] {
    return Object.entries(newState ?? {}).flatMap(([subsystemName, subsystemState]) =>
      Object.entries(subsystemState)
        .filter(
          ([metricName, newMetricState]) =>
            !isEqual(prevState?.[subsystemName]?.[metricName]?.data, newMetricState.data),
        )
        .map(([metricName]) => [subsystemName, metricName] as [string, string]),
    );
  }

  /** Reads the persisted state without notifying: unlike loadState, this runs on every read. */
  private async readState(): Promise<SystemState | null> {
    const latestPersistedState = await this.systemStateSnapshotRepo.findOne({ where: {}, order: { id: 'DESC' } });

    if (!latestPersistedState) {
      this.logger.warn('No monitoring state found in the database');
      return null;
    }

    return JSON.parse(latestPersistedState.data);
  }

  /**
   * The persisted state overlaid with anything this process holds more recently. Both matter: in
   * a single-process setup the in-memory state is always the newer one, and a value arriving
   * through the webhook is visible before the next persist.
   */
  private async currentState(): Promise<SystemState> {
    const stored = await this.storedState();

    return stored ? this.mergeNewer(stored, this.#$state.value) : this.#$state.value;
  }

  private async storedState(): Promise<SystemState | null> {
    if (this.#storedState && Date.now() - this.#storedState.loaded < MonitoringService.stateCacheMs) {
      return this.#storedState.state;
    }

    // Concurrent requests share one read rather than each issuing their own.
    if (!this.#pendingLoad) {
      const load = this.readState().catch((e) => {
        // No mail here, unlike loadState: this path is reached from getState, so a failing read
        // would notify once per request instead of once per start-up.
        this.logger.error('Failed to read the persisted system state:', e);
        return null;
      });

      this.#pendingLoad = load;
      void load.finally(() => {
        if (this.#pendingLoad === load) this.#pendingLoad = undefined;
      });
    }

    const state = await this.#pendingLoad;
    if (state) this.#storedState = { state, loaded: Date.now() };

    return state;
  }

  /** Per metric, whichever of the two carries the later `updated` timestamp. */
  private mergeNewer(base: SystemState, overlay: SystemState): SystemState {
    const merged = cloneDeep(base);

    for (const [subsystem, metrics] of Object.entries(overlay ?? {})) {
      for (const [metric, state] of Object.entries(metrics)) {
        if (this.updatedAt(state) >= this.updatedAt(merged[subsystem]?.[metric])) {
          merged[subsystem] = { ...(merged[subsystem] ?? {}), [metric]: state };
        }
      }
    }

    return merged;
  }

  /**
   * Parsed JSON carries `updated` as a string, the in-memory state as a Date. A missing or
   * unparsable value counts as the oldest possible, so a metric carrying one never wins a
   * comparison against a readable timestamp - and never blocks one either.
   */
  private updatedAt(metric?: Metric): number {
    const time = metric?.updated ? new Date(metric.updated).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  private getSubsystemState(state: SystemState, subsystem: string): SubsystemState {
    const _subsystem = state[subsystem];

    if (!_subsystem) {
      throw new NotFoundException(`Subsystem not found, name: ${subsystem}`);
    }
    return _subsystem;
  }

  private getMetric(state: SystemState, subsystem: string, metric: string): Metric {
    const _subsystem = this.getSubsystemState(state, subsystem);
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
    observer.$subscription.subscribe((data: unknown) =>
      this.updateSystemState(observer.subsystem, observer.metric, data),
    );
  }

  private async updateSystemState(subsystem: string, metric: string, data: unknown) {
    try {
      const currentState = cloneDeep(this.#$state.value);

      const newSubsystemState = currentState[subsystem] ?? {};
      const newMetricState = { data: cloneDeep(data), updated: new Date() };

      newSubsystemState[metric] = newMetricState;

      const newSystemState = { ...currentState, [subsystem]: newSubsystemState };

      this.#$state.next(newSystemState);
    } catch (e) {
      this.logger.error('Error updating monitoring state:', e);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: { subject: 'Monitoring Error. Updating monitoring state.', errors: [e] },
      });
    }
  }
}
