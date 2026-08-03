import { DeepMocked, createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MonitoringService } from '../monitoring.service';
import { Metric, SystemState } from '../system-state-snapshot.entity';
import { SystemStateSnapshotRepository } from '../system-state-snapshot.repository';

function snapshot(state: SystemState): { id: number; data: string } {
  return { id: 1, data: JSON.stringify(state) };
}

function metric(data: unknown, updated: string): Metric {
  return { data, updated: new Date(updated) };
}

describe('MonitoringService', () => {
  let repo: DeepMocked<SystemStateSnapshotRepository>;
  let notificationService: NotificationService;
  let service: MonitoringService;

  // Timestamps in the past, so a value written during the test is always the later one.
  const persisted: SystemState = {
    node: { health: metric({ up: true }, '2020-01-01T00:10:00Z') },
    bank: { balance: metric({ chf: 42 }, '2020-01-01T00:10:00Z') },
  };

  // As it comes back out of the database: JSON carries `updated` as a string, which serialises
  // identically in the response.
  const asRead = (): SystemState => JSON.parse(JSON.stringify(persisted));

  let lockedReads: unknown[];
  let written: { id: number; data: string }[];

  beforeEach(() => {
    lockedReads = [];
    written = [];

    repo = createMock<SystemStateSnapshotRepository>();
    repo.findOne.mockResolvedValue(snapshot(persisted) as never);

    // Stands in for the transaction: same row content, but through a manager whose lock option
    // and writes the test can inspect.
    const manager = {
      findOne: jest.fn().mockImplementation((_entity: unknown, options: { lock?: unknown }) => {
        lockedReads.push(options?.lock);
        return Promise.resolve(written.length ? written[written.length - 1] : snapshot(persisted));
      }),
      save: jest.fn().mockImplementation((_entity: unknown, row: { id: number; data: string }) => {
        written.push(row);
        return Promise.resolve(row);
      }),
    };
    Object.defineProperty(repo, 'manager', {
      value: { transaction: (run: (m: unknown) => Promise<unknown>) => run(manager) },
      configurable: true,
    });
    notificationService = createMock<NotificationService>();

    service = new MonitoringService(repo, notificationService);
  });

  describe('reading the state', () => {
    it('answers from the persisted state, not from the in-memory state', async () => {
      // Without this the endpoints behind GET /health* and /monitoring/data would answer from the
      // boot snapshot in any process not running the observers.
      await expect(service.getState(undefined, undefined)).resolves.toEqual(asRead());
    });

    it('refreshes the filtered queries too', async () => {
      // GET /monitoring/data takes subsystem and metric as query parameters. Refreshing only the
      // unfiltered branch would leave exactly those answers stale.
      await expect(service.getState('bank', undefined)).resolves.toEqual(asRead().bank);
      await expect(service.getState('bank', 'balance')).resolves.toEqual(asRead().bank.balance);
    });

    it('still reports an unknown subsystem or metric as not found', async () => {
      await expect(service.getState('ledger', undefined)).rejects.toThrow(NotFoundException);
      await expect(service.getState('bank', 'turnover')).rejects.toThrow(NotFoundException);
    });

    it('prefers whichever value carries the later timestamp', () => {
      const older: SystemState = { bank: { balance: metric({ chf: 42 }, '2020-01-01T00:10:00Z') } };
      const newer: SystemState = { bank: { balance: metric({ chf: 43 }, '2020-01-01T00:20:00Z') } };

      expect(service['mergeNewer'](older, newer).bank.balance.data).toEqual({ chf: 43 });
      expect(service['mergeNewer'](newer, older).bank.balance.data).toEqual({ chf: 43 });
    });

    it('shows a value produced in this process before it is persisted', async () => {
      // The webhook path writes into the in-memory state of whichever process receives the call,
      // and the persisted row follows only after the debounce. Reading the database alone would
      // answer with the older value in that window.
      await service['updateSystemState']('bank', 'balance', { chf: 99 });

      const state = (await service.getState(undefined, undefined)) as SystemState;

      expect(state.bank.balance.data).toEqual({ chf: 99 });
      expect(state.node.health.data).toEqual({ up: true });
    });

    it('reads at most once per cache window', async () => {
      await service.getState(undefined, undefined);
      await service.getState(undefined, undefined);

      expect(repo.findOne).toHaveBeenCalledTimes(1);
    });

    it('does not send a mail when the read fails', async () => {
      // Unlike the load at start-up this path runs on every request: a database problem would
      // otherwise answer itself with a flood of mails, precisely during the outage.
      repo.findOne.mockRejectedValue(new Error('database unavailable'));

      await expect(service.getState(undefined, undefined)).resolves.toEqual({});
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });
  });

  /** Lets the first transaction fail with the given database error, then behaves normally. */
  function failFirstWith(error: { code: string; message: string }): () => number {
    let attempts = 0;

    Object.defineProperty(repo, 'manager', {
      value: {
        transaction: (run: (m: unknown) => Promise<unknown>) => {
          attempts++;
          if (attempts === 1) return Promise.reject(Object.assign(new Error(error.message), { code: error.code }));

          return run({
            findOne: jest.fn().mockResolvedValue(snapshot(persisted)),
            save: jest.fn().mockImplementation((_e: unknown, row: { id: number; data: string }) => {
              written.push(row);
              return Promise.resolve(row);
            }),
          });
        },
      },
      configurable: true,
    });

    return () => attempts;
  }

  describe('persisting the state', () => {
    it('keeps metrics another process wrote', async () => {
      // Every process subscribes to its own updates and writes the same single row. Replacing it
      // with this process's view would drop the other's work - the API process would overwrite
      // the observers' results with its boot state.
      const prev: SystemState = { bank: { balance: metric({ chf: 42 }, '2020-01-01T00:10:00Z') } };
      const next: SystemState = { bank: { balance: metric({ chf: 43 }, '2020-01-01T00:20:00Z') } };

      await service['persist'](prev, next);

      const result = JSON.parse(written[0].data) as SystemState;

      expect(result.bank.balance.data).toEqual({ chf: 43 });
      expect(result.node.health.data).toEqual({ up: true });
    });

    it('writes nothing when no metric changed', async () => {
      await service['persist'](persisted, persisted);

      expect(written).toEqual([]);
    });

    it('reads the row under a write lock, in the same transaction it writes in', async () => {
      // Without the lock, merging only narrows the race instead of closing it: two writers that
      // both read before either wrote still overwrite each other - and the lost value does not
      // come back on its own, because the next run compares it against this process's own
      // previous state and finds it unchanged.
      const prev: SystemState = { bank: { balance: metric({ chf: 42 }, '2020-01-01T00:10:00Z') } };
      const next: SystemState = { bank: { balance: metric({ chf: 43 }, '2020-01-01T00:20:00Z') } };

      await service['persist'](prev, next);

      expect(lockedReads).toEqual([{ mode: 'pessimistic_write' }]);
      expect(written).toHaveLength(1);
    });

    it('does not put an older measurement back over a newer one', async () => {
      // This process may have waited on the lock while another wrote a later measurement of the
      // same metric. Writing regardless would restore the older value, and it would stay until
      // the metric changes here again.
      const prev: SystemState = { bank: { balance: metric({ chf: 1 }, '2020-01-01T00:00:00Z') } };
      const stale: SystemState = { bank: { balance: metric({ chf: 2 }, '2020-01-01T00:05:00Z') } };

      await service['persist'](prev, stale);

      const result = JSON.parse(written[0].data) as SystemState;

      expect(result.bank.balance.data).toEqual({ chf: 42 });
    });

    it('retries when the row cannot be locked because it does not exist yet', async () => {
      // An absent row cannot be locked, so two writers can reach the insert together and one
      // loses on the primary key. Without the retry that process's change is dropped until the
      // metric happens to change again.
      const attempts = failFirstWith({ code: '23505', message: 'duplicate key value' });

      const next: SystemState = { ledger: { open: metric({ count: 1 }, '2020-01-01T00:20:00Z') } };

      await service['persist']({}, next);

      expect(attempts()).toBe(2);
      expect(JSON.parse(written[0].data).ledger.open.data).toEqual({ count: 1 });
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('does not retry an error a second attempt cannot resolve', async () => {
      // The retry exists for the insert conflict and for deadlocks. Repeating a malformed row or
      // a permission error would only put the same failing statement on the database twice.
      const attempts = failFirstWith({ code: '42501', message: 'permission denied' });

      await service['persist']({}, { ledger: { open: metric({ count: 1 }, '2020-01-01T00:20:00Z') } });

      expect(attempts()).toBe(1);
      expect(written).toEqual([]);
      expect(notificationService.sendMail).toHaveBeenCalled();
    });

    it('writes a metric that did not exist before', async () => {
      const next: SystemState = { ledger: { open: metric({ count: 3 }, '2020-01-01T00:20:00Z') } };

      await service['persist']({}, next);

      const result = JSON.parse(written[0].data) as SystemState;

      expect(result.ledger.open.data).toEqual({ count: 3 });
      expect(result.bank.balance.data).toEqual({ chf: 42 });
    });
  });

  describe('an environment whose state row is not id 1', () => {
    // The write path targets id 1, so the read has to prefer it — reading the highest id would let
    // a second row make every read miss what is written. But whether a given database HAS that row
    // is not decidable from here, and reading only id 1 would answer null forever where it does
    // not: the observers are scoped to the worker, so the API process would never fill the state
    // itself and the monitoring endpoints would answer 404 indefinitely.

    /** A repository holding one row under a different id. */
    function withRowAt(id: number): void {
      repo.findOne.mockImplementation((options: { where?: { id?: number } }) =>
        Promise.resolve(options?.where?.id === 1 ? null : ({ id, data: JSON.stringify(persisted) } as never)),
      );
    }

    it('answers from the row that exists instead of reporting nothing', async () => {
      withRowAt(7);

      await expect(service.getState(undefined, undefined)).resolves.toEqual(asRead());
    });

    it('still reports nothing when there is no row at all', async () => {
      repo.findOne.mockResolvedValue(null as never);

      await expect(service.getState('node', 'health')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('seeds id 1 with what the old row held, not only with what this process changed', async () => {
      // Writing just the changed metric into a fresh id 1 would strand everything the old row
      // carried — and the reads, which prefer id 1, would then answer from the partial row.
      const managerFindOne = jest
        .fn()
        .mockImplementation((_entity: unknown, options: { where?: { id?: number } }) =>
          Promise.resolve(options?.where?.id === 1 ? null : { id: 7, data: JSON.stringify(persisted) }),
        );
      Object.defineProperty(repo, 'manager', {
        value: {
          transaction: (run: (m: unknown) => Promise<unknown>) =>
            run({
              findOne: managerFindOne,
              save: jest.fn().mockImplementation((_e: unknown, row: { id: number; data: string }) => {
                written.push(row);
                return Promise.resolve(row);
              }),
            }),
        },
        configurable: true,
      });

      await service['mergeIntoStoredState']([['aml', 'freeze']], {
        aml: { freeze: metric({ frozen: 0 }, '2030-01-01T00:00:00Z') },
      });

      expect(written).toHaveLength(1);
      expect(written[0].id).toEqual(1);

      const saved = JSON.parse(written[0].data);

      expect(saved.aml.freeze.data).toEqual({ frozen: 0 });
      expect(saved.node.health.data).toEqual({ up: true });
      expect(saved.bank.balance.data).toEqual({ chf: 42 });
    });
  });
});
