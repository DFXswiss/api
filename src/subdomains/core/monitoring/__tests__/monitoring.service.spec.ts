import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MonitoringService } from '../monitoring.service';
import { Metric, SystemState } from '../system-state-snapshot.entity';

function snapshot(state: SystemState): { id: number; data: string } {
  return { id: 1, data: JSON.stringify(state) };
}

function metric(data: unknown, updated: string): Metric {
  return { data, updated: new Date(updated) };
}

describe('MonitoringService', () => {
  let repo: any;
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

  beforeEach(() => {
    repo = { findOne: jest.fn().mockResolvedValue(snapshot(persisted)), save: jest.fn().mockResolvedValue(undefined) };
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

  describe('persisting the state', () => {
    it('keeps metrics another process wrote', async () => {
      // Every process subscribes to its own updates and writes the same single row. Replacing it
      // with this process's view would drop the other's work - the API process would overwrite
      // the observers' results with its boot state.
      const prev: SystemState = { bank: { balance: metric({ chf: 42 }, '2020-01-01T00:10:00Z') } };
      const next: SystemState = { bank: { balance: metric({ chf: 43 }, '2020-01-01T00:20:00Z') } };

      await service['persist'](prev, next);

      const written = JSON.parse(repo.save.mock.calls[0][0].data) as SystemState;

      expect(written.bank.balance.data).toEqual({ chf: 43 });
      expect(written.node.health.data).toEqual({ up: true });
    });

    it('writes nothing when no metric changed', async () => {
      await service['persist'](persisted, persisted);

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('writes a metric that did not exist before', async () => {
      const next: SystemState = { ledger: { open: metric({ count: 3 }, '2020-01-01T00:20:00Z') } };

      await service['persist']({}, next);

      const written = JSON.parse(repo.save.mock.calls[0][0].data) as SystemState;

      expect(written.ledger.open.data).toEqual({ count: 3 });
      expect(written.bank.balance.data).toEqual({ chf: 42 });
    });
  });
});
