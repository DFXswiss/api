import { createMock } from '@golevelup/ts-jest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService, GetConfig } from 'src/config/config';
import { DataSource } from 'typeorm';
import { CronLeaseService } from '../cron-lease.service';

/**
 * The lease is the only thing that stops a payout from running twice when two processes disagree
 * about who owns a job. Every test here is written from that angle: not "does the method return
 * true", but "can this state let the task run twice, or stop it from running at all".
 */
describe('CronLeaseService', () => {
  const original = process.env.CRON_ROLE;

  /** Mirrors the two shapes `DataSource.query` returns: rows for INSERT..RETURNING, [rows, count] for UPDATE. */
  function buildService(responses: { acquire?: unknown[]; renew?: [unknown[], number]; onQuery?: jest.Mock }) {
    const onQuery =
      responses.onQuery ??
      jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO')) return Promise.resolve(responses.acquire ?? [{ owner: 'x' }]);
        if (sql.includes('UPDATE')) return Promise.resolve(responses.renew ?? [[], 1]);
        return Promise.resolve([]);
      });

    return { service: new CronLeaseService(createMock<DataSource>({ query: onQuery })), onQuery };
  }

  beforeEach(() => {
    process.env.CRON_ROLE = 'worker';
    new ConfigService(GetConfig());
  });

  afterEach(() => {
    jest.clearAllMocks();

    if (original == null) delete process.env.CRON_ROLE;
    else process.env.CRON_ROLE = original;

    new ConfigService(GetConfig());
  });

  it('runs the task when it holds the lease', async () => {
    const { service } = buildService({ acquire: [{ owner: 'worker:1' }] });
    const task = jest.fn().mockResolvedValue(undefined);

    await service.run('SomeService::job', task);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does NOT run the task when another process holds the lease', async () => {
    // The claim statement returns no row when an unexpired lease belongs to someone else. This is
    // the case the whole mechanism exists for: the second process must stay out.
    const { service } = buildService({ acquire: [] });
    const task = jest.fn().mockResolvedValue(undefined);

    await service.run('SomeService::job', task);

    expect(task).not.toHaveBeenCalled();
  });

  it('does NOT run the task when the database is unreachable', async () => {
    // Fail-closed on purpose. A job that moves money must not proceed on the assumption that it is
    // probably alone — an unreachable database is exactly when that assumption is least safe.
    const onQuery = jest.fn().mockRejectedValue(new Error('connection refused'));
    const { service } = buildService({ onQuery });
    const task = jest.fn().mockResolvedValue(undefined);

    await service.run('SomeService::job', task);

    expect(task).not.toHaveBeenCalled();
  });

  it('releases the lease even when the task throws', async () => {
    // Without this an error would leave the row behind, and the job would sit out every cycle
    // until the lease expired — a silent outage of that job.
    const { service, onQuery } = buildService({});
    const task = jest.fn().mockRejectedValue(new Error('job blew up'));

    await expect(service.run('SomeService::job', task)).rejects.toThrow('job blew up');

    expect(onQuery.mock.calls.some(([sql]) => (sql as string).includes('DELETE FROM'))).toBe(true);
  });

  it('claims only a lease that has expired, never one that is still held', async () => {
    // The safety of the whole thing rests on this single statement, so its shape is pinned here:
    // an upsert whose update branch is conditional on expiry. Drop the WHERE and two processes
    // would happily take turns owning the same job.
    const { service, onQuery } = buildService({});

    await service.acquire('SomeService::job');

    const sql = (onQuery.mock.calls[0][0] as string).replace(/\s+/g, ' ');

    expect(sql).toContain('ON CONFLICT ("name") DO UPDATE');
    expect(sql).toContain('WHERE "cron_lease"."expires" <= now()');
    expect(sql).toContain('RETURNING "owner"');
  });

  it('scopes renewal and release to this process', async () => {
    // A run that already lost its lease must not be able to extend or delete the row a different
    // process now owns.
    const { service, onQuery } = buildService({});

    await service.renew('SomeService::job');
    await service.release('SomeService::job');

    const [renewSql] = onQuery.mock.calls[0];
    const [releaseSql] = onQuery.mock.calls[1];

    expect((renewSql as string).replace(/\s+/g, ' ')).toContain('WHERE "name" = $1 AND "owner" = $2');
    expect((releaseSql as string).replace(/\s+/g, ' ')).toContain('WHERE "name" = $1 AND "owner" = $2');
  });

  it('gives two processes of the same role different owners', async () => {
    // The role alone would let a restarted container renew the lease its predecessor took. The
    // random part is what makes the owner identify a process rather than a kind of process.
    const { service: first, onQuery: firstQuery } = buildService({});
    const { service: second, onQuery: secondQuery } = buildService({});

    await first.acquire('SomeService::job');
    await second.acquire('SomeService::job');

    const firstOwner = firstQuery.mock.calls[0][1][1] as string;
    const secondOwner = secondQuery.mock.calls[0][1][1] as string;

    expect(firstOwner.startsWith('worker:')).toBe(true);
    expect(secondOwner.startsWith('worker:')).toBe(true);
    expect(firstOwner).not.toEqual(secondOwner);
  });

  describe('lease duration', () => {
    // The expiry decides how long a job stays blocked after a process dies without releasing.
    // Reading it off the job's own timeout made that window as long as the job was allowed to
    // take — up to two hours for the jobs declaring the longest timeouts.

    it('claims for a minute, whatever the job it guards is allowed to take', async () => {
      const { service, onQuery } = buildService({});

      await service.acquire('SomeService::job');

      expect(onQuery.mock.calls[0][1][2]).toEqual('60');
    });

    it('renews for the same short span', async () => {
      const { service, onQuery } = buildService({});

      await service.renew('SomeService::job');

      expect(onQuery.mock.calls[0][1][2]).toEqual('60');
    });
  });

  describe('shutdown', () => {
    // A deployment sends SIGTERM in the middle of a run. Whatever happens here decides whether the
    // successor can pick the job up, and whether it can pick it up while this process still works
    // on it.

    /** Lets pending promises settle without advancing any timer. */
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    const released = (onQuery: jest.Mock) =>
      onQuery.mock.calls.some(([sql]) => (sql as string).includes('DELETE FROM'));

    it('does not take the lease away from a job that is still running', async () => {
      // The dangerous direction. Releasing on SIGTERM would let the successor claim the lease and
      // start the same job while this process keeps working on it for the rest of its stop grace
      // period — the double run the lease exists to prevent.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        const { service, onQuery } = buildService({});
        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));

        await settle();

        const shutdown = service.shutdown();
        await settle();

        // Grace expires with the job still working.
        jest.advanceTimersByTime(10_000);
        await shutdown;

        expect(released(onQuery)).toBe(false);

        finish();
        await run;
      } finally {
        jest.useRealTimers();
      }
    });

    it('waits for the running job instead of letting the process leave under it', async () => {
      // The reason for waiting at all: the run gets to reach its own release, so the successor
      // finds no row and starts the job on its next tick instead of sitting out the expiry.
      // Without the hook the shutdown would be over before the job is, which is what the pending
      // assertion below pins — the release alone proves nothing, it happens either way.
      const { service, onQuery } = buildService({});
      let finish: () => void;
      const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));

      await settle();

      let over = false;
      const shutdown = service.shutdown().then(() => (over = true));
      await settle();

      expect(over).toBe(false);
      expect(released(onQuery)).toBe(false);

      finish();
      await run;
      await shutdown;

      expect(over).toBe(true);
      expect(released(onQuery)).toBe(true);
    });

    it('is reached at all, because bootstrap wires it to the signal', () => {
      // Nothing calls this on its own. Without the wiring in bootstrap everything above is dead
      // code and a deployment kills the process mid-job, which is the state this change came
      // from. Read from the source because there is nothing to call.
      const main = readFileSync(join(__dirname, '..', '..', '..', 'main.ts'), 'utf8');

      expect(main).toContain('releaseCronLeasesOnShutdown(app)');
      expect(main).toContain("'SIGTERM'");
      expect(main).toMatch(/leases\s*\n?\s*\.shutdown\(\)/);
    });

    it("is NOT wired through Nest's global shutdown hooks", () => {
      // `enableShutdownHooks` would also start running nine `onModuleDestroy` hooks that have
      // never run here, before this one, emptying the strategy registries that PayIn, PayOut and
      // DEX jobs resolve from — while the wait above deliberately keeps those jobs alive longer.
      // Pinned because the idiomatic call is exactly what a later reader would reach for. Comment
      // lines are dropped first: the reason for not calling it is written down right next to the
      // wiring, and a check that cannot tell the two apart would fail on its own explanation.
      const main = readFileSync(join(__dirname, '..', '..', '..', 'main.ts'), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');

      expect(main).not.toMatch(/app\.enableShutdownHooks\(/);
    });

    it('returns immediately when no job is running', async () => {
      // The overwhelmingly common case on a deployment: nothing outstanding, so shutdown must not
      // spend the grace period waiting for it.
      const { service } = buildService({});

      await service.shutdown();
    });

    it('stops tracking a run once it is done, so a later shutdown has nothing to wait for', async () => {
      const { service } = buildService({});

      await service.run('SomeService::job', jest.fn().mockResolvedValue(undefined));

      expect([...(service['inFlight'] as Map<string, unknown>).keys()]).toEqual([]);
    });
  });

  describe('visibility of an unusable lease table', () => {
    // Without the table every claim fails and every worker- and api-scoped job is skipped. Not
    // running is the right answer; looking healthy while doing it is not, and the role heartbeat
    // is exempt from the lease so it never noticed.

    it('says so at start-up when the table cannot be read', async () => {
      const onQuery = jest.fn().mockRejectedValue(new Error('relation "cron_lease" does not exist'));
      const { service } = buildService({ onQuery });

      await service.onModuleInit();

      expect(service.takeFailures()).toEqual({
        healthy: false,
        count: 1,
        last: 'relation "cron_lease" does not exist',
      });
    });

    it('stays unusable across heartbeats until an operation succeeds', async () => {
      // A role whose jobs are all sitting out produces no new failures either. Were the state
      // per window, the second heartbeat would look healthy again while nothing had changed.
      const onQuery = jest.fn().mockRejectedValue(new Error('connection refused'));
      const { service } = buildService({ onQuery });

      await service.run('SomeService::job', jest.fn());

      expect(service.takeFailures()).toMatchObject({ healthy: false, count: 1 });
      expect(service.takeFailures()).toMatchObject({ healthy: false, count: 0 });
    });

    it('reports healthy again once a claim gets through', async () => {
      // The counterpart: a transient outage must not leave the process reporting an error for the
      // rest of its life.
      const onQuery = jest.fn().mockRejectedValueOnce(new Error('connection refused'));
      const { service } = buildService({ onQuery });

      await service.onModuleInit();
      expect(service.takeFailures().healthy).toBe(false);

      onQuery.mockResolvedValue([{ owner: 'worker:1' }]);
      await service.acquire('SomeService::job');

      expect(service.takeFailures().healthy).toBe(true);
    });

    it('starts out healthy, so the heartbeat does not cry wolf before anything ran', () => {
      const { service } = buildService({});

      expect(service.takeFailures()).toEqual({ healthy: true, count: 0, last: undefined });
    });
  });

  describe('a lost race that is not routine', () => {
    // For a worker job, losing the lease is the mechanism working: the other worker is doing the
    // work and the result lands in the database. For a job whose effect exists only inside the
    // process that runs it, the same outcome means the effect did not happen where it was needed.
    // Nothing distinguishes the two at the lease, so the caller says which it is.

    it('reports the loss for a job whose effect is local to its process', async () => {
      const { service } = buildService({ acquire: [] });
      const error = jest.spyOn(service['logger'], 'error').mockImplementation();
      const task = jest.fn();

      await service.run('PaymentCronService::processExpiredPayments', task, true);

      expect(task).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain('PaymentCronService::processExpiredPayments');
    });

    it('stays quiet for a job whose result lands in the database', async () => {
      // These lose the race every cycle by design — one worker holds the lease, the other does
      // not. Reporting that would bury the case above under noise.
      const { service } = buildService({ acquire: [] });
      const error = jest.spyOn(service['logger'], 'error').mockImplementation();

      await service.run('SomeWorkerService::job', jest.fn());

      expect(error).not.toHaveBeenCalled();
    });
  });
});
