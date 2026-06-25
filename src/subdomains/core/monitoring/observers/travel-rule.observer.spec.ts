import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { Util } from 'src/shared/utils/util';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { UserRepository } from 'src/subdomains/generic/user/models/user/user.repository';
import { TravelRuleObserver } from './travel-rule.observer';

describe('TravelRuleObserver', () => {
  let observer: TravelRuleObserver;

  let monitoringService: MonitoringService;
  let userRepo: UserRepository;
  let repos: RepositoryFactory;

  // a valid EVM signature (0x + 130 hex) so the fail-closed format check counts it as processable
  const validSignature = `0x${'a'.repeat(130)}`;
  // a Lightning-style signature ([a-z0-9]{104}) the job's allowlist never renders → must be counted
  // as skippedUnrecognised. Starts with `0` so it cannot accidentally match the Monero base58 format
  // (which excludes 0/O/I/l) — i.e. a deterministically non-allowlisted candidate.
  const skippedSignature = `0${'a'.repeat(103)}`;

  // captures every raw SQL fragment the claimedWithoutFile query builds via andWhere(), so a test can
  // assert the generated SQL itself (not just the mocked result). The original full mock hid a
  // runtime-fatal regression: `kf` is a raw table alias, so TypeORM does not auto-quote its camelCase
  // identifiers and PostgreSQL folds them to lowercase ("column kf.userdataid does not exist"). The
  // spec must therefore see the actual SQL and fail if the camelCase identifiers are not double-quoted.
  let capturedClaimedSql: string[];

  // first createQueryBuilder() chain returns the raw candidates (getRawMany), the second returns the
  // claimedWithoutFile count (getRawOne); a single shared chainable stub captures both terminals
  function mockQueries(candidates: { signature: string; updated: Date }[], claimedWithoutFile: number): void {
    capturedClaimedSql = [];
    const candidatesQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(candidates),
    };
    const claimedQb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockImplementation((sql: string) => {
        capturedClaimedSql.push(sql);
        return claimedQb;
      }),
      getRawOne: jest.fn().mockResolvedValue({ claimedWithoutFile: `${claimedWithoutFile}` }),
    };
    jest
      .spyOn(userRepo, 'createQueryBuilder')
      .mockReturnValueOnce(candidatesQb as any)
      .mockReturnValueOnce(claimedQb as any);
  }

  beforeEach(async () => {
    monitoringService = createMock<MonitoringService>();
    userRepo = createMock<UserRepository>();
    repos = createMock<RepositoryFactory>({ user: userRepo });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TravelRuleObserver,
        { provide: MonitoringService, useValue: monitoringService },
        { provide: RepositoryFactory, useValue: repos },
      ],
    }).compile();

    observer = module.get<TravelRuleObserver>(TravelRuleObserver);
  });

  it('should be defined', () => {
    expect(observer).toBeDefined();
  });

  it('registers itself with the monitoring service under travelRule/pdf', () => {
    expect(monitoringService.register).toHaveBeenCalledWith(observer);
    expect(observer.subsystem).toBe('travelRule');
    expect(observer.metric).toBe('pdf');
  });

  it('counts only processable candidates as backlog and unrecognised ones separately', async () => {
    const now = new Date();
    mockQueries(
      [
        { signature: validSignature, updated: now },
        { signature: validSignature, updated: now },
        { signature: skippedSignature, updated: now }, // Lightning → never rendered by the job
        { signature: '00000000-0000-4000-8000-000000000000', updated: now }, // masterKey UUID
      ],
      0,
    );

    const data = await observer.fetch();

    expect(data.backlog).toBe(2);
    expect(data.skippedUnrecognised).toBe(2);
  });

  it('reports null oldestAge when there is no processable backlog', async () => {
    // only unrecognised candidates present → backlog empty, no age to report
    mockQueries([{ signature: skippedSignature, updated: new Date() }], 0);

    const data = await observer.fetch();

    expect(data.backlog).toBe(0);
    expect(data.skippedUnrecognised).toBe(1);
    expect(data.oldestAgeHours).toBeNull();
  });

  it('derives oldestAgeHours from the oldest PROCESSABLE candidate only', async () => {
    const oldProcessable = Util.minutesBefore(180); // 3h ago
    const newerProcessable = Util.minutesBefore(60); // 1h ago
    const evenOlderSkipped = Util.minutesBefore(600); // 10h ago, but unrecognised → ignored

    mockQueries(
      [
        { signature: validSignature, updated: newerProcessable },
        { signature: validSignature, updated: oldProcessable },
        { signature: skippedSignature, updated: evenOlderSkipped },
      ],
      0,
    );

    const data = await observer.fetch();

    // ~3h from the oldest processable candidate, NOT ~10h from the older skipped one
    expect(data.oldestAgeHours).toBeGreaterThanOrEqual(2.9);
    expect(data.oldestAgeHours).toBeLessThanOrEqual(3.1);
  });

  it('surfaces the claimedWithoutFile count (claim leak / orphan blob)', async () => {
    mockQueries([{ signature: validSignature, updated: new Date() }], 5);

    const data = await observer.fetch();

    expect(data.claimedWithoutFile).toBe(5);
  });

  // Regression guard: `kf` is a raw (non-TypeORM) alias in the claimedWithoutFile subquery, so its
  // camelCase identifiers must be double-quoted by hand. Without the quotes PostgreSQL folds them to
  // lowercase and the query throws "column kf.userdataid does not exist" every 10 minutes at runtime.
  // The original spec fully mocked this away — this assertion inspects the actual generated SQL.
  it('double-quotes the camelCase identifiers in the claimedWithoutFile subquery (raw kf alias)', async () => {
    mockQueries([{ signature: validSignature, updated: new Date() }], 0);

    await observer.fetch();

    const notExistsSql = capturedClaimedSql.find((sql) => sql.includes('NOT EXISTS'));
    expect(notExistsSql).toBeDefined();
    // camelCase identifiers must be quoted verbatim, never left bare (which PostgreSQL lowercases)
    expect(notExistsSql).toContain('kf."userDataId"');
    expect(notExistsSql).toContain('kf."subType"');
    expect(notExistsSql).toContain('"user"."userDataId"');
    expect(notExistsSql).not.toMatch(/kf\.userDataId\b/);
    expect(notExistsSql).not.toMatch(/kf\.subType\b/);
    expect(notExistsSql).not.toMatch(/user\.userDataId\b/);
  });

  it('emits the fetched data to subscribers', async () => {
    const now = new Date();
    mockQueries([{ signature: validSignature, updated: now }], 0);

    const emitted: any[] = [];
    observer.$subscription.subscribe((d) => emitted.push(d));

    const data = await observer.fetch();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(data);
  });
});
