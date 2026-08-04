import { createMock } from '@golevelup/ts-jest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService, GetConfig } from 'src/config/config';
import { DataSource } from 'typeorm';
import { CronLeaseService } from '../cron-lease.service';

/**
 * The lease is what a second process has to get past before it may START a job it should not be
 * running. It does not rule a double run out, and it does not bound how long one lasts — the
 * jobs' own tolerance of a repeat and a deployment that runs one worker are what carry that, and
 * this is a layer over them. Every test here is written from that angle: not "does the method
 * return true", but "can this state let a second process in, or stop the task from running at
 * all".
 */
describe('CronLeaseService', () => {
  const original = process.env.CRON_ROLE;

  /** Mirrors the two shapes `DataSource.query` returns: rows for INSERT..RETURNING, [rows, count] for UPDATE
   * and DELETE — the driver answers both the same way, and `release` reads the count. */
  function buildService(responses: { acquire?: unknown[]; renew?: [unknown[], number]; onQuery?: jest.Mock }) {
    const onQuery =
      responses.onQuery ??
      jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO')) return Promise.resolve(responses.acquire ?? [{ owner: 'x' }]);
        if (sql.includes('UPDATE')) return Promise.resolve(responses.renew ?? [[], 1]);
        if (sql.includes('DELETE')) return Promise.resolve([[], 1]);
        return Promise.resolve([]);
      });

    return { service: new CronLeaseService(createMock<DataSource>({ query: onQuery })), onQuery };
  }

  /** Lets pending promises settle without advancing any timer. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

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

  describe('when the lease table cannot be reached', () => {
    /** Every claim attempt fails, as it would with no table, no grant or no database. */
    const unreachable = () =>
      jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO')) return Promise.reject(new Error('relation "cron_lease" does not exist'));
        return Promise.resolve([]);
      });

    it('runs the task anyway under `all`, because one process is what that role means', async () => {
      // The rollout puts this application version into production SEVERAL STEPS before the alert
      // that reads the lease heartbeat. In that window an unreachable table would otherwise stop
      // 123 of 139 jobs — payouts among them — with nothing to report it.
      //
      // Under `all` the deployment runs one process, which is the shape the API had before any
      // lease existed. Skipping there would make the lease STRICTLY WORSE than its own absence.
      process.env.CRON_ROLE = 'all';
      new ConfigService(GetConfig());

      const { service } = buildService({ onQuery: unreachable() });
      const task = jest.fn().mockResolvedValue(undefined);

      await service.run('SomeService::job', task);

      expect(task).toHaveBeenCalledTimes(1);
    });

    it('does NOT run it under `worker`, where the lease is the only separation', async () => {
      // The other direction, and the reason this is a role question rather than a blanket rule:
      // with two processes, running anyway is the double run the lease exists to prevent.
      process.env.CRON_ROLE = 'worker';
      new ConfigService(GetConfig());

      const { service } = buildService({ onQuery: unreachable() });
      const task = jest.fn().mockResolvedValue(undefined);

      await service.run('SomeService::job', task);

      expect(task).not.toHaveBeenCalled();
    });

    it('waits for a lease-less run at shutdown, like any other', async () => {
      // The fail-open path once called the task directly and skipped the `inFlight` entry with
      // it. A payout started that way was invisible to `shutdown`: no grace period, and the
      // "still running" warning said nothing was.
      process.env.CRON_ROLE = 'all';
      new ConfigService(GetConfig());

      const { service } = buildService({ onQuery: unreachable() });
      let finish: () => void;
      const task = jest.fn().mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));

      const run = service.run('SomeService::job', task);
      await settle();

      // Read by job rather than by key: the map is keyed per RUN, so two runs of one job stay
      // apart in it.
      const tracked = () => [...service['inFlight'].values()].map((entry) => entry.job);

      expect(tracked()).toEqual(['SomeService::job']);

      finish();
      await run;

      expect(tracked()).toEqual([]);
    });

    it('does not start a lease-less run once shutdown has begun', async () => {
      // The claim attempt runs to the database timeout, so this window is WIDER than the healthy
      // one — and a run started inside it would be cut off part-way through.
      process.env.CRON_ROLE = 'all';
      new ConfigService(GetConfig());

      const { service } = buildService({ onQuery: unreachable() });
      const task = jest.fn().mockResolvedValue(undefined);

      service['shuttingDown'] = true;
      await service.run('SomeService::job', task);

      expect(task).not.toHaveBeenCalled();
    });

    it('reports the failure in the heartbeat either way', async () => {
      // Running anyway must not look healthy: the reason still has to reach the alert.
      process.env.CRON_ROLE = 'all';
      new ConfigService(GetConfig());

      const { service } = buildService({ onQuery: unreachable() });

      await service.run('SomeService::job', jest.fn().mockResolvedValue(undefined));

      const failures = service.takeFailures();

      expect(failures.healthy).toBe(false);
      expect(failures.count).toEqual(1);
    });
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

    await service.acquire('SomeService::job', 'worker:p:r');

    const sql = (onQuery.mock.calls[0][0] as string).replace(/\s+/g, ' ');

    expect(sql).toContain('ON CONFLICT ("name") DO UPDATE');
    expect(sql).toContain('WHERE "cron_lease"."expires" <= now()');
    expect(sql).toContain('RETURNING "owner"');
  });

  it('scopes renewal and release to the run that took the claim', async () => {
    // A run that already lost its lease must not be able to extend or delete the row another run
    // now owns — in another process or, after LockClass gives up on a long one, in this one.
    const { service, onQuery } = buildService({});

    await service.renew('SomeService::job', 'worker:p:r');
    await service.release('SomeService::job', 'worker:p:r');

    const [renewSql] = onQuery.mock.calls[0];
    const [releaseSql] = onQuery.mock.calls[1];

    expect((renewSql as string).replace(/\s+/g, ' ')).toContain('WHERE "name" = $1 AND "owner" = $2');
    expect((releaseSql as string).replace(/\s+/g, ' ')).toContain('WHERE "name" = $1 AND "owner" = $2');
  });

  it('gives two RUNS of the same job different owners, so one cannot release the claim of the other', async () => {
    // Reachable in one process: `LockClass` gives up on a job that outlives its declared timeout,
    // so the next tick starts a second run of the same job here while the first still works. It
    // can take the claim once a failed renewal has let the first one lapse — and then, under a
    // per-PROCESS owner, both runs would match `name + owner`. Whichever finished first would
    // delete the row the other is holding, and a third process could start the job alongside it.
    const { service, onQuery } = buildService({});

    let release: (() => void) | undefined;
    const first = service.run('SomeService::job', () => new Promise<void>((resolve) => (release = resolve)));
    await settle();

    await service.run('SomeService::job', async () => undefined);
    release?.();
    await first;

    const owners = onQuery.mock.calls
      .filter(([sql]) => (sql as string).includes('INSERT INTO'))
      .map(([, params]) => params[1] as string);

    expect(owners).toHaveLength(2);
    expect(owners[0]).not.toEqual(owners[1]);
    // Same process, so the process part is shared and only the run part differs — an operator
    // still reads which container the row belongs to.
    expect(owners[0].split(':').slice(0, 2)).toEqual(owners[1].split(':').slice(0, 2));

    const deleted = onQuery.mock.calls
      .filter(([sql]) => (sql as string).includes('DELETE FROM'))
      .map(([, params]) => params[1] as string);

    expect(deleted).toEqual(expect.arrayContaining([owners[0], owners[1]]));
  });

  it('waits for BOTH runs of a job on shutdown, not just the last one to start', async () => {
    // The in-flight record is keyed by run for the same reason. Keyed by job name the second run
    // would replace the first, and whichever finished first would delete the entry of the other —
    // leaving a run that shutdown neither waits for nor names.
    const { service } = buildService({});

    const done: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;

    const first = service
      .run('SomeService::job', () => new Promise<void>((resolve) => (releaseFirst = resolve)))
      .then(() => done.push('first'));
    await settle();
    const second = service
      .run('SomeService::job', () => new Promise<void>((resolve) => (releaseSecond = resolve)))
      .then(() => done.push('second'));
    await settle();

    const shutdown = service.shutdown().then(() => done.push('shutdown'));

    // Only the SECOND run finishes. Whether shutdown is still waiting is the whole question: keyed
    // by job name the first run's entry is already gone, so it would consider itself done here and
    // `main.ts` would exit on top of a payout that is still running.
    releaseSecond?.();
    await settle();

    expect(done).toEqual(['second']);

    releaseFirst?.();
    await Promise.all([first, second, shutdown]);

    expect(done).toEqual(['second', 'first', 'shutdown']);
  });

  it('gives two processes of the same role different owners', async () => {
    // The role alone would let a restarted container renew the lease its predecessor took. The
    // random part is what makes the owner identify a process rather than a kind of process.
    const { service: first, onQuery: firstQuery } = buildService({});
    const { service: second, onQuery: secondQuery } = buildService({});

    await first.run('SomeService::job', async () => undefined);
    await second.run('SomeService::job', async () => undefined);

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

      await service.acquire('SomeService::job', 'worker:p:r');

      expect(onQuery.mock.calls[0][1][2]).toEqual('60');
    });

    it('renews for the same short span', async () => {
      const { service, onQuery } = buildService({});

      await service.renew('SomeService::job', 'worker:p:r');

      expect(onQuery.mock.calls[0][1][2]).toEqual('60');
    });

    it('keeps one renewal outstanding at a time', async () => {
      // A fixed interval fires whether or not the previous renewal came back. A database that
      // answers slowly is exactly when this matters: the attempts pile up, each holding a pooled
      // connection, and an older answer can land after a newer one. Here the renewal never comes
      // back at all, so a fixed interval would have started two more by the time this asserts.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let renewals = 0;
        const onQuery = jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO')) return Promise.resolve([{ owner: 'worker:1' }]);
          if (sql.includes('UPDATE')) {
            renewals++;
            return new Promise(() => undefined);
          }

          if (sql.includes('DELETE')) return Promise.resolve([[], 1]);
          return Promise.resolve([]);
        });

        const { service } = buildService({ onQuery });
        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));

        await settle();

        // Three renewal intervals (20 s each) with the first one still unanswered.
        jest.advanceTimersByTime(61_000);
        await settle();

        expect(renewals).toEqual(1);

        finish();
        await run;
      } finally {
        jest.useRealTimers();
      }
    });

    it('renews AGAIN after a renewal that came back', async () => {
      // The renewal re-arms itself once the previous one has settled. Without that, every run
      // longer than one interval would renew exactly once and then let its claim lapse at 60 s
      // while it is still working. The test above cannot see this: its renewal never answers, so
      // there is nothing to re-arm from and one renewal is the correct count there.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let renewals = 0;
        const onQuery = jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO')) return Promise.resolve([{ owner: 'worker:1' }]);
          if (sql.includes('UPDATE')) {
            renewals++;
            return Promise.resolve([[], 1]);
          }

          if (sql.includes('DELETE')) return Promise.resolve([[], 1]);
          return Promise.resolve([]);
        });

        const { service } = buildService({ onQuery });
        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));

        await settle();

        jest.advanceTimersByTime(20_000);
        await settle();

        expect(renewals).toEqual(1);

        jest.advanceTimersByTime(20_000);
        await settle();

        expect(renewals).toEqual(2);

        finish();
        await run;
      } finally {
        jest.useRealTimers();
      }
    });

    /** Drives one renewal that answers after `answerAfterMs`, then reports when the next fires. */
    async function cadenceAfterAnswerTaking(answerAfterMs: number) {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let renewals = 0;
        let answer: (result: [unknown[], number]) => void;
        const onQuery = jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO')) return Promise.resolve([{ owner: 'worker:1' }]);
          if (sql.includes('UPDATE')) {
            renewals++;
            return new Promise((resolve) => (answer = resolve));
          }

          return Promise.resolve([[], 1]);
        });

        const { service } = buildService({ onQuery });
        jest.spyOn(service['logger'], 'warn').mockImplementation();
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        jest.advanceTimersByTime(20_000);
        await settle();

        jest.advanceTimersByTime(answerAfterMs);
        answer([[], 1]);
        await settle();

        const afterAnswer = renewals;

        // No further time passes. Only a renewal that is already due can fire here.
        jest.advanceTimersByTime(0);
        await settle();

        const immediately = renewals;

        finish();
        await run;

        // Watched so a stray loss line cannot pass unnoticed here, as it could while this helper
        // spied only on `warn`. It does not prove much on its own — the outstanding renewal in the
        // 45 s case never answers — but an unwatched logger is how one hid before.
        expect(error).not.toHaveBeenCalled();

        return { afterAnswer, immediately };
      } finally {
        jest.useRealTimers();
      }
    }

    it('re-arms at once after an answer that outran the interval', async () => {
      // Waiting a further interval from the ANSWER added the database's latency to a wait already
      // sized to include it: an attempt answering at 45 s put the next at 65 s. For a FAILED
      // attempt that is past the 60 s expiry; this fixture answers success, so what it pins is the
      // cadence itself — the next attempt comes due at once rather than 20 s after the answer.
      const { afterAnswer, immediately } = await cadenceAfterAnswerTaking(45_000);

      expect(afterAnswer).toEqual(1);
      expect(immediately).toEqual(2);
    });

    it('still waits out the rest of the interval after a prompt answer', async () => {
      // The counterpart: subtracting the elapsed time must not turn the renewal into a busy loop.
      const { afterAnswer, immediately } = await cadenceAfterAnswerTaking(2_000);

      expect(afterAnswer).toEqual(1);
      expect(immediately).toEqual(1);
    });
  });

  describe('shutdown', () => {
    // A deployment sends SIGTERM in the middle of a run. Whatever happens here decides whether the
    // successor can pick the job up, and whether it can pick it up while this process still works
    // on it.

    const released = (onQuery: jest.Mock) =>
      onQuery.mock.calls.some(([sql]) => (sql as string).includes('DELETE FROM'));

    it('does not take the lease away from a job that is still running', async () => {
      // The dangerous direction. Releasing on SIGTERM would let the successor claim the lease and
      // start the same job while this process keeps working on it — a double run for as long as
      // the container leaves this process alive, which is the stop grace period and nothing the
      // lease has a say in. Holding the lease is what keeps the successor out of it.
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

    it('stops taking new requests before it waits', () => {
      // The wait keeps this process alive for up to the grace period. Without closing the listener
      // it goes on accepting requests for that whole span and then cuts them off at `process.exit`
      // — a window that did not exist while the signal ended the process at once. Comment lines
      // are dropped first, as in the test below: the reason sits next to the call.
      const main = readFileSync(join(__dirname, '..', '..', '..', 'main.ts'), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');

      const handler = main.slice(main.indexOf('function releaseCronLeasesOnShutdown'));
      const close = handler.indexOf('app.getHttpServer().close()');
      const wait = handler.indexOf('.shutdown()');

      expect(close).toBeGreaterThan(-1);
      expect(close).toBeLessThan(wait);
      // And the listener only: `app.close()` runs the module-destroy hooks the test below is about.
      expect(handler).not.toMatch(/\bapp\.close\(/);
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

    it('starts no further job once shutdown has begun', async () => {
      // The wait above covers the jobs that were running when shutdown took its snapshot, and the
      // process exits when that wait ends. A job started afterwards is in no snapshot, so it would
      // be cut off part-way through — with the exit landing before its own `finally`.
      const { service, onQuery } = buildService({});
      const task = jest.fn().mockResolvedValue(undefined);

      await service.shutdown();
      await service.run('SomeService::job', task);

      expect(task).not.toHaveBeenCalled();
      expect(onQuery.mock.calls.some(([sql]) => (sql as string).includes('INSERT INTO'))).toBe(false);
    });

    it('hands the claim back when shutdown begins while it is being taken', async () => {
      // Claiming is a round trip, so the guard above can be passed just before shutdown starts.
      // The run must not begin under that claim, and should not leave the row behind either — the
      // successor would then sit out the full expiry for a job that never ran.
      //
      // Pinned here is the path where the process lives long enough to do it. It is not a promise
      // that it always does: the claim is not in `inFlight`, so `shutdown` does not wait for it,
      // and an exit in between leaves the row to lapse on its TTL.
      let answerClaim: (rows: unknown[]) => void;
      const onQuery = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO')) return new Promise((resolve) => (answerClaim = resolve));
        if (sql.includes('DELETE')) return Promise.resolve([[], 1]);
        return Promise.resolve([]);
      });

      const { service } = buildService({ onQuery });
      const task = jest.fn().mockResolvedValue(undefined);
      const run = service.run('SomeService::job', task);

      await settle();
      await service.shutdown();

      answerClaim([{ owner: 'worker:1' }]);
      await run;

      expect(task).not.toHaveBeenCalled();
      expect(released(onQuery)).toBe(true);
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
      await service.acquire('SomeService::job', 'worker:p:r');

      expect(service.takeFailures().healthy).toBe(true);
    });

    it('reports healthy again once a RENEWAL gets through, not only a claim', async () => {
      // The heartbeat reports this as a state, so every operation that reaches the table has to
      // clear it. A process running long jobs renews for minutes at a time without claiming
      // anything new: healing on the claim alone would leave it reporting a failure it has already
      // recovered from until its next acquire.
      const onQuery = jest.fn().mockRejectedValueOnce(new Error('connection refused'));
      const { service } = buildService({ onQuery });

      await service.onModuleInit();
      expect(service.takeFailures().healthy).toBe(false);

      onQuery.mockResolvedValue([[], 1]);
      await service.renew('SomeService::job', 'worker:p:r');

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

      await service.run('StatisticService::doUpdate', task, true);

      expect(task).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain('StatisticService::doUpdate');
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

  describe('reporting a lost lease', () => {
    // The line is a measurement, not just an alert: the TTL has to be dimensioned on how OFTEN a
    // claim is really lost. Each case below is a way an earlier version counted something else.

    /**
     * Acquire succeeds; `renew` and the release DELETE answer whatever the case needs.
     * The DELETE's row count is what separates this run's own release from a takeover.
     */
    function lease(opts: { renew: () => Promise<unknown>; release?: () => Promise<unknown> }) {
      return jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO')) return Promise.resolve([{ owner: 'worker:1' }]);
        if (sql.includes('UPDATE')) return opts.renew();
        if (sql.includes('DELETE')) return (opts.release ?? (() => Promise.resolve([[], 1])))();

        return Promise.resolve([]);
      });
    }

    /** Starts a run, lets one renewal fire and stall, finishes the run, then answers the renewal. */
    async function releaseRacingAStalledRenewal(release?: () => Promise<unknown>) {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let answer: (result: [unknown[], number]) => void;
        const onQuery = lease({ renew: () => new Promise((resolve) => (answer = resolve)), release });

        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();
        jest.spyOn(service['logger'], 'warn').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        jest.advanceTimersByTime(20_000);
        await settle();

        finish();
        await run;

        // Long enough that any age-based rule would call the claim expired.
        jest.advanceTimersByTime(90_000);
        answer([[], 0]);
        await settle();

        return error;
      } finally {
        jest.useRealTimers();
      }
    }

    it("stays quiet when this run's own release removed the row", async () => {
      // `stop` cannot cancel an attempt that has already fired, so a finishing run races its own
      // release: the DELETE lands first and the outstanding UPDATE then matches nothing. A DELETE
      // that removed a row proves the row was still ours, so nothing had taken it.
      const error = await releaseRacingAStalledRenewal(() => Promise.resolve([[], 1]));

      expect(error).not.toHaveBeenCalled();
    });

    it('reports the loss when the release found the row already gone', async () => {
      // Same race, opposite fact. A DELETE that removed nothing proves the row had been taken over
      // or vanished before the run ended — a real loss, and it must survive the run finishing.
      const error = await releaseRacingAStalledRenewal(() => Promise.resolve([[], 0]));

      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain('Lost the lease');
    });

    it('reports the loss when the release itself failed', async () => {
      // Unknown is not the same as safe: a release that threw leaves it undecided whether the row
      // went, and the honest default is the one that still reports.
      const error = await releaseRacingAStalledRenewal(() => Promise.reject(new Error('connection lost')));

      const lost = error.mock.calls.map((c) => c[0]).filter((line: string) => line.includes('Lost the lease'));
      expect(lost).toHaveLength(1);
    });

    it('waits for the release before deciding, when the renewal answers first', async () => {
      // The renewal and the release run on different pooled connections, so the DELETE can execute
      // first in the database while its answer arrives second here. Reading a flag the release sets
      // would then still be unset, and a row this run's own release had taken would be reported as
      // lost — the same false line, just through a narrower window.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let answerRenewal: (result: [unknown[], number]) => void;
        let answerRelease: (result: [unknown[], number]) => void;
        const onQuery = lease({
          renew: () => new Promise((resolve) => (answerRenewal = resolve)),
          release: () => new Promise((resolve) => (answerRelease = resolve)),
        });

        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();
        jest.spyOn(service['logger'], 'warn').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        jest.advanceTimersByTime(20_000);
        await settle();

        // The run ends and the DELETE goes out, but has not come back yet.
        finish();
        await settle();

        // The renewal answers FIRST, matching nothing because the DELETE already executed.
        answerRenewal([[], 0]);
        await settle();

        expect(error).not.toHaveBeenCalled();

        // Only now does the release report that the row was ours.
        answerRelease([[], 1]);
        await run;
        await settle();

        expect(error).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('reports a loss the release alone can see, with no renewal left to notice it', async () => {
      // A renewal is outstanding only for its round trip out of every interval, and `stop` cancels
      // an overdue one before it can run. A job that blocks the event loop past the expiry, loses
      // the claim and then finishes therefore has no renewal left — its DELETE removing zero rows
      // is the only remaining proof. Reporting only from the renewal would make the count depend
      // on how long a run happens to continue past its loss.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        // No renewal ever fires: the run ends before the first one is due.
        const onQuery = lease({
          renew: () => Promise.resolve([[], 1]),
          release: () => Promise.resolve([[], 0]),
        });

        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();

        await service.run('SomeService::job', () => Promise.resolve());
        await settle();

        expect(error).toHaveBeenCalledTimes(1);
        expect(error.mock.calls[0][0]).toContain('Lost the lease');
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not report twice when the RENEWAL answers before the release', async () => {
      // The ordering the sibling below does NOT cover, and the natural one: the renewal's UPDATE
      // goes out up to an interval before the DELETE, so a stall that queues both answers it
      // first. The renewal then tests the latch, awaits the release, and resumes into a check it
      // read before the release had reported — which is why the latch lives inside `reportLoss`.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let answerRenewal: (result: [unknown[], number]) => void;
        let answerRelease: (result: [unknown[], number]) => void;
        const onQuery = lease({
          renew: () => new Promise((resolve) => (answerRenewal = resolve)),
          release: () => new Promise((resolve) => (answerRelease = resolve)),
        });

        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();
        jest.spyOn(service['logger'], 'warn').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        jest.advanceTimersByTime(20_000);
        await settle();

        // The run ends and the DELETE goes out, still unanswered.
        finish();
        await settle();

        // The renewal answers FIRST and starts waiting on the release.
        answerRenewal([[], 0]);
        await settle();

        // Only now does the release come back, having removed nothing — both discoverers see it.
        answerRelease([[], 0]);
        await run;
        await settle();

        const lost = error.mock.calls.map((c) => c[0]).filter((line: string) => line.includes('Lost the lease'));
        expect(lost).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not report twice when the RELEASE answers before the renewal', async () => {
      // The other ordering. Here the release settles first and reports, and the renewal resumes
      // into a latch that is already set. Its sibling above covers the reverse, which is the one
      // that actually broke — this case passed even before the latch moved inside `reportLoss`.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let answerRenewal: (result: [unknown[], number]) => void;
        const onQuery = lease({
          renew: () => new Promise((resolve) => (answerRenewal = resolve)),
          release: () => Promise.resolve([[], 0]),
        });

        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();
        jest.spyOn(service['logger'], 'warn').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        jest.advanceTimersByTime(20_000);
        await settle();

        finish();
        await run;

        answerRenewal([[], 0]);
        await settle();

        const lost = error.mock.calls.map((c) => c[0]).filter((line: string) => line.includes('Lost the lease'));
        expect(lost).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('stays silent when a release that threw is the only thing that could have noticed', async () => {
      // The one case neither answer covers. A statement that never answered is not evidence the
      // claim went, so with no renewal in flight there is nothing to report from — only `run`'s
      // own "Could not release" line. Pinned so the gap stays deliberate rather than drifting.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        const onQuery = lease({
          renew: () => Promise.resolve([[], 1]),
          release: () => Promise.reject(new Error('connection lost')),
        });

        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();

        // Ends before the first renewal is due, so no renewal is ever outstanding.
        await service.run('SomeService::job', () => Promise.resolve());
        await settle();

        const lines = error.mock.calls.map((c) => c[0] as string);
        expect(lines.filter((l) => l.includes('Lost the lease'))).toHaveLength(0);
        expect(lines.filter((l) => l.includes('Could not release the lease'))).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('reports a loss while the run is still going', async () => {
      // Nothing has been released here at all, so the run is simply no longer the owner.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        const onQuery = lease({ renew: () => Promise.resolve([[], 0]) });
        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        jest.advanceTimersByTime(20_000);
        await settle();

        expect(error).toHaveBeenCalledTimes(1);

        finish();
        await run;
      } finally {
        jest.useRealTimers();
      }
    });

    it('reports a real loss once, not again on every renewal', async () => {
      // The timer deliberately keeps going after a loss, so an unlatched line repeats every 20 s
      // for the rest of the run — up to ~360 lines for a two-hour job, all from ONE event.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        const onQuery = lease({ renew: () => Promise.resolve([[], 0]) });
        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        for (let i = 0; i < 6; i++) {
          jest.advanceTimersByTime(20_000);
          await settle();
        }

        expect(error).toHaveBeenCalledTimes(1);

        finish();
        await run;
      } finally {
        jest.useRealTimers();
      }
    });

    it('stays silent when a renewal succeeds again after a loss was reported', async () => {
      // `renew` carries no expiry predicate, so a claim that lapsed and that nobody else has taken
      // is silently revived by a late renewal and answers true. The latch has to survive that: the
      // loss happened, and a second line for the same run would double-count it.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let matches = 0;
        const onQuery = lease({ renew: () => Promise.resolve([[], matches]) });
        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        jest.advanceTimersByTime(20_000);
        await settle();
        expect(error).toHaveBeenCalledTimes(1);

        // The row is ours again, and stays ours for several more attempts.
        matches = 1;
        for (let i = 0; i < 3; i++) {
          jest.advanceTimersByTime(20_000);
          await settle();
        }

        expect(error).toHaveBeenCalledTimes(1);

        finish();
        await run;
      } finally {
        jest.useRealTimers();
      }
    });

    it('names the owner and how long the claim had gone unconfirmed', async () => {
      // Without an identity a line cannot be attributed to a run, and the age is what a TTL
      // decision is read off.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        const onQuery = lease({ renew: () => Promise.resolve([[], 0]) });
        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        jest.advanceTimersByTime(20_000);
        await settle();

        const line = error.mock.calls[0][0];
        expect(line).toContain('SomeService::job');
        expect(line).toContain('worker:');
        expect(line).toContain('20.0 s since the claim was last confirmed');

        finish();
        await run;
      } finally {
        jest.useRealTimers();
      }
    });

    it('measures that age from a renewal that succeeded, not from the claim', async () => {
      // Without advancing the anchor the age would grow from the acquire forever and describe a
      // claim that had in fact been extended all along.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let succeed = true;
        const onQuery = lease({ renew: () => Promise.resolve([[], succeed ? 1 : 0]) });
        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        // Four renewals land, carrying the claim well past its original 60 s expiry.
        for (let i = 0; i < 4; i++) {
          jest.advanceTimersByTime(20_000);
          await settle();
        }

        expect(error).not.toHaveBeenCalled();

        succeed = false;
        jest.advanceTimersByTime(20_000);
        await settle();

        // 20 s since the last accepted renewal, not the 100 s since the claim.
        expect(error.mock.calls[0][0]).toContain('20.0 s since the claim was last confirmed');

        finish();
        await run;
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('a renewal that fails outright', () => {
    it('reports every failure and counts each one for the heartbeat', async () => {
      // Deliberately unlatched, unlike the two lines above it: each failure is a distinct event
      // with its own cause, and `takeFailures` counts per window, so collapsing them would
      // under-report a persistent outage. The branch was restructured by this change and neither
      // half of that contract was asserted.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        const onQuery = jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO')) return Promise.resolve([{ owner: 'worker:1' }]);
          if (sql.includes('UPDATE')) return Promise.reject(new Error('connection terminated'));

          return Promise.resolve([[], 1]);
        });

        const { service } = buildService({ onQuery });
        const error = jest.spyOn(service['logger'], 'error').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        service.takeFailures();

        for (let i = 0; i < 3; i++) {
          jest.advanceTimersByTime(20_000);
          await settle();
        }

        const failed = error.mock.calls.map((c) => c[0] as string).filter((l) => l.includes('Could not extend'));
        expect(failed).toHaveLength(3);
        expect(service.takeFailures().count).toEqual(3);

        finish();
        await run;
      } finally {
        jest.useRealTimers();
      }
    });

    it('reports a non-Error throw without losing its text', async () => {
      // The restructure routes failures through `e instanceof Error ? e : new Error(String(e))`,
      // and `recordFailure` runs in the renewal's catch — not in `renew` itself — so this has to
      // be driven through a real run to exercise it.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        const onQuery = jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO')) return Promise.resolve([{ owner: 'worker:1' }]);
          if (sql.includes('UPDATE')) return Promise.reject('pool drained');

          return Promise.resolve([[], 1]);
        });

        const { service } = buildService({ onQuery });
        jest.spyOn(service['logger'], 'error').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        service.takeFailures();

        jest.advanceTimersByTime(20_000);
        await settle();

        expect(service.takeFailures().last).toContain('pool drained');

        finish();
        await run;
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('a renewal that is merely slow', () => {
    // Only a FAILING renewal was ever visible. A slow one silently spends the margin the TTL
    // provides, which is the thing any cadence decision has to be measured against.

    /** Runs `durations.length` renewals, each taking that many ms, and returns the warnings. */
    async function renewalsTaking(durations: number[], outcome: 'answers' | 'rejects' = 'answers') {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let settleRenewal: (result: [unknown[], number]) => void;
        let rejectRenewal: (e: Error) => void;
        const onQuery = jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO')) return Promise.resolve([{ owner: 'worker:1' }]);
          if (sql.includes('UPDATE'))
            return new Promise((resolve, reject) => {
              settleRenewal = resolve;
              rejectRenewal = reject;
            });

          return Promise.resolve([[], 1]);
        });

        const { service } = buildService({ onQuery });
        const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();
        jest.spyOn(service['logger'], 'error').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        // The re-arm subtracts whatever the previous attempt spent, so the wait before each
        // attempt is not a flat interval — advancing by one would leak into the next measurement.
        let untilNext = 20_000;

        for (const took of durations) {
          jest.advanceTimersByTime(untilNext);
          await settle();

          // The clock moves while the statement is outstanding, which is what the line measures.
          jest.advanceTimersByTime(took);
          if (outcome === 'answers') settleRenewal([[], 1]);
          else rejectRenewal(new Error('connection terminated'));
          await settle();

          untilNext = Math.max(0, 20_000 - took);
        }

        finish();
        await run;

        return warn;
      } finally {
        jest.useRealTimers();
      }
    }

    it('reports one that took longer than the threshold', async () => {
      const warn = await renewalsTaking([6_000]);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('6.0 s');
    });

    it('stays quiet for one that answered promptly', async () => {
      const warn = await renewalsTaking([50]);

      expect(warn).not.toHaveBeenCalled();
    });

    it('reports one that was slow and then REJECTED', async () => {
      // The shape a statement timeout produces, and the case the threshold is named after.
      // Measuring inside the arm that answered would report nothing at all for it.
      const warn = await renewalsTaking([6_000], 'rejects');

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('6.0 s');
    });

    it('does not count the release it waits for as part of the renewal', async () => {
      // A renewal that matches nothing waits for the release before deciding. That wait is the
      // round trip this change exists to survive, and folding it into the renewal's own duration
      // would print a slow release as a slow renewal — corrupting the one number a statement
      // timeout on `renew` would be sized against.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let answerRenewal: (result: [unknown[], number]) => void;
        let answerRelease: (result: [unknown[], number]) => void;
        const onQuery = jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO')) return Promise.resolve([{ owner: 'worker:1' }]);
          if (sql.includes('UPDATE')) return new Promise((resolve) => (answerRenewal = resolve));
          if (sql.includes('DELETE')) return new Promise((resolve) => (answerRelease = resolve));

          return Promise.resolve([[], 1]);
        });

        const { service } = buildService({ onQuery });
        const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();
        jest.spyOn(service['logger'], 'error').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        // The renewal must be OUTSTANDING when the release goes out — `stop` clears the timer, so
        // finishing first would mean no renewal ever fires and the test would prove nothing.
        jest.advanceTimersByTime(20_000);
        await settle();

        finish();
        await settle();

        // It answers at once, matching nothing, and then waits on the stalled release for 90 s.
        answerRenewal([[], 0]);
        await settle();

        jest.advanceTimersByTime(90_000);
        answerRelease([[], 1]);
        await run;
        await settle();

        expect(warn).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('reports only a new worst, keeping the largest rather than the first', async () => {
      // Latching on the first would freeze the number at 6 s for a run that later renewed in 300 s,
      // and 300 s is what a timeout would have to be sized against. A line per attempt would
      // instead count run length.
      const warn = await renewalsTaking([6_000, 7_000, 6_500, 300_000, 8_000]);

      expect(warn.mock.calls.map((c) => c[0])).toEqual([
        expect.stringContaining('6.0 s'),
        expect.stringContaining('7.0 s'),
        expect.stringContaining('300.0 s'),
      ]);
    });
  });

  describe('a claim that was slow to answer', () => {
    /** Acquire takes `acquireMs` to answer; then reports when the first renewal fires. */
    async function firstRenewalAfterAcquireTaking(acquireMs: number) {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let renewals = 0;
        let answerAcquire: (rows: unknown[]) => void;
        const onQuery = jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO')) return new Promise((resolve) => (answerAcquire = resolve));
          if (sql.includes('UPDATE')) {
            renewals++;
            return Promise.resolve([[], 1]);
          }

          return Promise.resolve([[], 1]);
        });

        const { service } = buildService({ onQuery });
        jest.spyOn(service['logger'], 'warn').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        jest.advanceTimersByTime(acquireMs);
        answerAcquire([{ owner: 'worker:1' }]);
        await settle();

        // No time passes: only a renewal that is already due can fire.
        jest.advanceTimersByTime(0);
        await settle();

        const immediately = renewals;

        finish();
        await run;

        return immediately;
      } finally {
        jest.useRealTimers();
      }
    }

    it('brings the first renewal due at once when the claim outran the interval', async () => {
      // `keepAlive` is reached only once the claim has ANSWERED, so a flat first wait would add the
      // claim's round trip to a wait already sized to contain it: a claim issued at 0 and answered
      // at 45 s expires at ~60 s, and the first renewal would land at 65 s.
      expect(await firstRenewalAfterAcquireTaking(45_000)).toEqual(1);
    });

    it('still waits out the interval after a prompt claim', async () => {
      expect(await firstRenewalAfterAcquireTaking(100)).toEqual(0);
    });
  });

  describe('the wall clock stepping backwards', () => {
    it('never waits longer than one interval', async () => {
      // `Date.now()` is not monotonic: an NTP correction or a resume from suspend can move it back
      // between an attempt starting and answering, which without the upper clamp would make the
      // elapsed term negative and the next wait `interval + step` — unbounded, on the one timer
      // that must not miss a deadline.
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

      try {
        let renewals = 0;
        let answer: (result: [unknown[], number]) => void;
        const onQuery = jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO')) return Promise.resolve([{ owner: 'worker:1' }]);
          if (sql.includes('UPDATE')) {
            renewals++;
            return new Promise((resolve) => (answer = resolve));
          }

          return Promise.resolve([[], 1]);
        });

        const { service } = buildService({ onQuery });
        jest.spyOn(service['logger'], 'warn').mockImplementation();

        let finish: () => void;
        const run = service.run('SomeService::job', () => new Promise<void>((resolve) => (finish = resolve)));
        await settle();

        jest.advanceTimersByTime(20_000);
        await settle();
        expect(renewals).toEqual(1);

        // The clock jumps back ten minutes while the statement is outstanding.
        jest.setSystemTime(Date.now() - 600_000);
        answer([[], 1]);
        await settle();

        // One interval is still enough to bring the next attempt due.
        jest.advanceTimersByTime(20_000);
        await settle();

        expect(renewals).toEqual(2);

        finish();
        await run;
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
