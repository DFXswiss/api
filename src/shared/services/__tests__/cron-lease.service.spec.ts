import { createMock } from '@golevelup/ts-jest';
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

    await service.run('SomeService::job', 60, task);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does NOT run the task when another process holds the lease', async () => {
    // The claim statement returns no row when an unexpired lease belongs to someone else. This is
    // the case the whole mechanism exists for: the second process must stay out.
    const { service } = buildService({ acquire: [] });
    const task = jest.fn().mockResolvedValue(undefined);

    await service.run('SomeService::job', 60, task);

    expect(task).not.toHaveBeenCalled();
  });

  it('does NOT run the task when the database is unreachable', async () => {
    // Fail-closed on purpose. A job that moves money must not proceed on the assumption that it is
    // probably alone — an unreachable database is exactly when that assumption is least safe.
    const onQuery = jest.fn().mockRejectedValue(new Error('connection refused'));
    const { service } = buildService({ onQuery });
    const task = jest.fn().mockResolvedValue(undefined);

    await service.run('SomeService::job', 60, task);

    expect(task).not.toHaveBeenCalled();
  });

  it('releases the lease even when the task throws', async () => {
    // Without this an error would leave the row behind, and the job would sit out every cycle
    // until the lease expired — a silent outage of that job.
    const { service, onQuery } = buildService({});
    const task = jest.fn().mockRejectedValue(new Error('job blew up'));

    await expect(service.run('SomeService::job', 60, task)).rejects.toThrow('job blew up');

    expect(onQuery.mock.calls.some(([sql]) => (sql as string).includes('DELETE FROM'))).toBe(true);
  });

  it('claims only a lease that has expired, never one that is still held', async () => {
    // The safety of the whole thing rests on this single statement, so its shape is pinned here:
    // an upsert whose update branch is conditional on expiry. Drop the WHERE and two processes
    // would happily take turns owning the same job.
    const { service, onQuery } = buildService({});

    await service.acquire('SomeService::job', 60);

    const sql = (onQuery.mock.calls[0][0] as string).replace(/\s+/g, ' ');

    expect(sql).toContain('ON CONFLICT ("name") DO UPDATE');
    expect(sql).toContain('WHERE "cron_lease"."expires" <= now()');
    expect(sql).toContain('RETURNING "owner"');
  });

  it('scopes renewal and release to this process', async () => {
    // A run that already lost its lease must not be able to extend or delete the row a different
    // process now owns.
    const { service, onQuery } = buildService({});

    await service.renew('SomeService::job', 60);
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

    await first.acquire('SomeService::job', 60);
    await second.acquire('SomeService::job', 60);

    const firstOwner = firstQuery.mock.calls[0][1][1] as string;
    const secondOwner = secondQuery.mock.calls[0][1][1] as string;

    expect(firstOwner.startsWith('worker:')).toBe(true);
    expect(secondOwner.startsWith('worker:')).toBe(true);
    expect(firstOwner).not.toEqual(secondOwner);
  });
});
