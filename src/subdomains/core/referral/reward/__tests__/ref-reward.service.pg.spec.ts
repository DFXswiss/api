import { createMock } from '@golevelup/ts-jest';
import { DataType, newDb } from 'pg-mem';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { Column, DataSource, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { RewardStatus } from '../ref-reward.entity';
import { RefRewardRepository } from '../ref-reward.repository';
import { RefRewardService } from '../services/ref-reward.service';

// the real RefReward / User entities cannot be registered standalone (relations pull in the whole
// entity graph), so these tables mirror only the columns getRewardRecipients actually touches —
// under the real table names
@Entity({ name: 'user' })
class UserTable {
  @PrimaryGeneratedColumn()
  id: number;

  // production resolves u.userDataId via the userData ManyToOne; the query never joins user_data,
  // so a plain FK column is enough for the stub schema
  @Column()
  userDataId: number;
}

@Entity({ name: 'ref_reward' })
class RefRewardTable {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'timestamp' })
  created: Date;

  @Column({ type: 'float', nullable: true })
  amountInChf?: number;

  // Explicit varchar: without it TypeORM infers the column type from the TS type, and an enum
  // reflects as Object, which the postgres driver rejects. The real column is character varying too.
  @Column({ type: 'varchar', nullable: true })
  status?: RewardStatus;

  // Relation path for `.innerJoin('r.user', ...)`; createForeignKeyConstraints is false so seed
  // order is unconstrained.
  @ManyToOne(() => UserTable, { nullable: false, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'userId' })
  user: UserTable;
}

// runs getRewardRecipients against a Postgres-semantics engine (pg-mem) to verify the ORDER BY
// alias quoting and aggregation semantics, because a mocked query builder never executes SQL and
// an unquoted orderBy('totalChf') would otherwise go unnoticed (column "totalchf" does not exist)
describe('RefRewardService.getRewardRecipients (postgres semantics)', () => {
  let dataSource: DataSource;
  let repo: RefRewardRepository;
  let service: RefRewardService;

  const oldDate = new Date('2025-01-15T00:00:00.000Z');
  const newDate = new Date('2026-06-01T00:00:00.000Z');

  beforeAll(async () => {
    const db = newDb();
    // TypeORM runs SELECT version() / current_database() on connect; pg-mem does not ship them
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });
    // The query rounds the summed amount; pg-mem ships no two-argument round(). Registering it keeps
    // the statement executable so the test can assert what it is actually about — the ORDER BY alias
    // and the aggregation — rather than failing on a missing built-in.
    db.public.registerFunction({
      name: 'round',
      args: [DataType.float, DataType.integer],
      returns: DataType.float,
      implementation: (value: number, digits: number) => {
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
      },
    });

    dataSource = (await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [UserTable, RefRewardTable],
      synchronize: true,
    })) as DataSource;
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.getRepository(RefRewardTable).clear();
    await dataSource.getRepository(UserTable).clear();

    repo = dataSource.getRepository(RefRewardTable) as unknown as RefRewardRepository;
    service = new RefRewardService(
      repo,
      createMock<UserService>(),
      createMock<PricingService>(),
      createMock<AssetService>(),
      createMock<TransactionService>(),
      createMock<SettingService>(),
    );
  });

  async function seedFixture(): Promise<void> {
    const userRepo = dataSource.getRepository(UserTable);
    const rewardRepo = dataSource.getRepository(RefRewardTable);

    // userDataId 10: two separate user accounts (user10, user10b) share this userDataId — the
    // `User.userData` relation is @ManyToOne (user.entity.ts), so more than one user account can
    // point at the same userDataId. COMPLETE 100 (user10) + COMPLETE 200.4 (user10b) -> totalChf
    // 300.4, rounds DOWN to 300, count 2. A regression that additionally groups by u.id would
    // split this into two separate rows instead of one merged row.
    // userDataId 20: COMPLETE 150 + PREPARED 50 -> totalChf 200, count 2. PREPARED is neither
    // COMPLETE nor USER_SWITCH, so it pins that the exclusion filter is "status != USER_SWITCH",
    // not "status == COMPLETE". Also one row with no status (NULL) and amountInChf 999: the filter
    // `r.status != :excluded` does not keep it (NULL != 'user_switch' is NULL under three-valued
    // logic), so count/totalChf for 20 stay 2/200.
    // userDataId 30: COMPLETE 50 (created = oldDate) + COMPLETE 25.6 (created = newDate)
    //   -> totalChf 75.6, rounds UP to 76, count 2 (two rows aggregate)
    // userDataId 40: only USER_SWITCH -> must not appear
    // userDataId 50: COMPLETE 100 + USER_SWITCH 999 -> totalChf 100, count 1 (USER_SWITCH excluded)
    //
    // 10 and 30 straddle a rounding boundary (...300.4 down, ...75.6 up) on purpose: every seeded
    // amount used to be a whole number, so ROUND(..., 0) accidentally regressing to ROUND(..., 1) —
    // or the sum being truncated instead of rounded — would have left every expected total unchanged
    // and the test green.
    //
    // Do not hard-code user ids: clear() does not reset the PrimaryGeneratedColumn sequence, so
    // rewards must link to the entities returned by save().
    const [user10, user10b, user20, user30, user40, user50] = await userRepo.save([
      { userDataId: 10 },
      { userDataId: 10 },
      { userDataId: 20 },
      { userDataId: 30 },
      { userDataId: 40 },
      { userDataId: 50 },
    ]);

    await rewardRepo.save([
      { created: newDate, amountInChf: 100, status: RewardStatus.COMPLETE, user: user10 },
      { created: newDate, amountInChf: 200.4, status: RewardStatus.COMPLETE, user: user10b },
      { created: newDate, amountInChf: 150, status: RewardStatus.COMPLETE, user: user20 },
      { created: newDate, amountInChf: 50, status: RewardStatus.PREPARED, user: user20 },
      // no status -> NULL in DB; excluded by three-valued logic of `status != USER_SWITCH`
      { created: newDate, amountInChf: 999, user: user20 },
      { created: oldDate, amountInChf: 50, status: RewardStatus.COMPLETE, user: user30 },
      { created: newDate, amountInChf: 25.6, status: RewardStatus.COMPLETE, user: user30 },
      { created: newDate, amountInChf: 500, status: RewardStatus.USER_SWITCH, user: user40 },
      { created: newDate, amountInChf: 100, status: RewardStatus.COMPLETE, user: user50 },
      { created: newDate, amountInChf: 999, status: RewardStatus.USER_SWITCH, user: user50 },
    ]);
  }

  // Isolated seed for the mixed null-amount group only — must not touch seedFixture(), whose four
  // callers pin exact result arrays and would fail if a throwing group were mixed in.
  async function seedMixedAmountGroup(): Promise<number> {
    const userRepo = dataSource.getRepository(UserTable);
    const rewardRepo = dataSource.getRepository(RefRewardTable);

    const user = await userRepo.save({ userDataId: 60 });
    await rewardRepo.save([
      { created: newDate, amountInChf: 100, status: RewardStatus.COMPLETE, user },
      { created: newDate, status: RewardStatus.COMPLETE, user },
    ]);
    return user.userDataId;
  }

  // Isolated seed for rounded totalChf ties only — userDataIds 70/80 do not appear in seedFixture
  // or seedMixedAmountGroup. Amounts 100.4 and 99.6 both ROUND(..., 0) to 100. Inserts the group
  // that must sort later first (80 before 70) so insertion order disagrees with userDataId ASC.
  async function seedRoundedTotalChfTie(): Promise<void> {
    const userRepo = dataSource.getRepository(UserTable);
    const rewardRepo = dataSource.getRepository(RefRewardTable);

    const [user80, user70] = await userRepo.save([{ userDataId: 80 }, { userDataId: 70 }]);
    await rewardRepo.save([
      { created: newDate, amountInChf: 100.4, status: RewardStatus.COMPLETE, user: user80 },
      { created: newDate, amountInChf: 99.6, status: RewardStatus.COMPLETE, user: user70 },
    ]);
  }

  it('returns recipients sorted by totalChf DESC, excluding USER_SWITCH from sum/count, pure USER_SWITCH recipients, and merges multiple accounts under one userDataId', async () => {
    await seedFixture();

    // must not throw (the prod bug: QueryFailedError: column "totalchf" does not exist)
    const result = await service.getRewardRecipients();

    // no normalization here on purpose: getRewardRecipients() itself must hand back real numbers
    // (see the driver-string conversion in the service), so this asserts the method's actual output.
    expect(result).toEqual([
      { userDataId: 10, count: 2, totalChf: 300 },
      { userDataId: 20, count: 2, totalChf: 200 },
      { userDataId: 50, count: 1, totalChf: 100 },
      { userDataId: 30, count: 2, totalChf: 76 },
    ]);
    expect(result.map((r) => r.userDataId)).not.toContain(40);
    expect(result.every((row, i) => i === 0 || result[i - 1].totalChf >= row.totalChf)).toBe(true);
  });

  it('casts the summed amount to numeric and quotes the ORDER BY alias in the generated SQL', async () => {
    // pg-mem maps Postgres' `numeric` onto its own float type (node_modules/pg-mem/index.js:
    // `'numeric': { type: DataType.float, ignoreConfig: true }`), so the two-argument round()
    // registered above resolves the query above whether or not the ::numeric cast is present in
    // the SELECT expression — removing the cast would leave that test green while breaking on real
    // Postgres (no two-argument round(double precision, integer)), the same way the original bug
    // did. So this test does not rely on pg-mem rejecting anything; it pins the cast, and the
    // ORDER BY alias quoting, by inspecting the SQL text itself.
    //
    // getRewardRecipients builds and discards its query builder internally without ever returning
    // or storing it anywhere reachable from outside, and the production code must not be reshaped
    // just to make the SQL reachable from a test. Spying on createQueryBuilder on the injected `repo`
    // INSTANCE (not the shared TypeORM prototype) captures the exact builder this call creates;
    // getRawMany is then spied on that one builder instance — again the instance, not the prototype —
    // to read `getSql()` right before handing off to the real implementation, so the query still
    // actually runs.
    const originalCreateQueryBuilder = repo.createQueryBuilder.bind(repo);
    let capturedSql: string | undefined;
    const createQueryBuilderSpy = jest
      .spyOn(repo, 'createQueryBuilder')
      .mockImplementation((...args: Parameters<typeof repo.createQueryBuilder>) => {
        const qb = originalCreateQueryBuilder(...args);
        const originalGetRawMany = qb.getRawMany.bind(qb);
        jest.spyOn(qb, 'getRawMany').mockImplementation(() => {
          capturedSql = qb.getSql();
          return originalGetRawMany();
        });
        return qb;
      });

    try {
      await service.getRewardRecipients();
    } finally {
      createQueryBuilderSpy.mockRestore();
    }

    expect(capturedSql).toContain('SUM("r"."amountInChf")::numeric');
    // Full ORDER BY: primary totalChf DESC, then stable u.userDataId ASC tie-breaker (TypeORM
    // quotes the entity path via join metadata the same way it quotes "r"."amountInChf" above).
    expect(capturedSql).toContain('ORDER BY "totalChf" DESC, "u"."userDataId" ASC');
  });

  it('orders equal rounded totalChf groups by userDataId ASC', async () => {
    await seedRoundedTotalChfTie();

    const result = await service.getRewardRecipients();

    // Both sums round to the same whole CHF; order must still be deterministic via userDataId ASC.
    expect(result.map((r) => r.totalChf)).toEqual([100, 100]);
    expect(result.map((r) => r.userDataId)).toEqual([70, 80]);
  });

  // pg-mem returns COUNT/SUM as JS numbers already, so it never exercises the node-postgres string
  // parsing path that the service converts with +row.count / +row.totalChf. These two tests feed
  // driver-shaped raw rows through getRawMany so that conversion (and the count vs. amountCount
  // mismatch check for the all-null case) stay covered.
  it('coerces driver string values for count and totalChf to numbers', async () => {
    const originalCreateQueryBuilder = repo.createQueryBuilder.bind(repo);
    let getRawManySpy: jest.SpyInstance | undefined;
    const createQueryBuilderSpy = jest
      .spyOn(repo, 'createQueryBuilder')
      .mockImplementation((...args: Parameters<typeof repo.createQueryBuilder>) => {
        const qb = originalCreateQueryBuilder(...args);
        getRawManySpy = jest.spyOn(qb, 'getRawMany').mockImplementation(() =>
          Promise.resolve([
            // amountCount matches count: full groups, no missing amounts intended here
            { userDataId: 10, count: '2', amountCount: '2', totalChf: '300' },
            { userDataId: 20, count: '1', amountCount: '1', totalChf: '150' },
          ]),
        );
        return qb;
      });

    try {
      const result = await service.getRewardRecipients();

      expect(result).toStrictEqual([
        { userDataId: 10, count: 2, totalChf: 300 },
        { userDataId: 20, count: 1, totalChf: 150 },
      ]);
      expect(typeof result[0].count).toBe('number');
      expect(typeof result[0].totalChf).toBe('number');
      expect(typeof result[1].count).toBe('number');
      expect(typeof result[1].totalChf).toBe('number');
    } finally {
      getRawManySpy?.mockRestore();
      createQueryBuilderSpy.mockRestore();
    }
  });

  it('throws when totalChf sum is null, naming the affected userDataId', async () => {
    const originalCreateQueryBuilder = repo.createQueryBuilder.bind(repo);
    let getRawManySpy: jest.SpyInstance | undefined;
    const createQueryBuilderSpy = jest
      .spyOn(repo, 'createQueryBuilder')
      .mockImplementation((...args: Parameters<typeof repo.createQueryBuilder>) => {
        const qb = originalCreateQueryBuilder(...args);
        // amountCount 0 with count 1: every amount in the group is null (SUM is null)
        getRawManySpy = jest
          .spyOn(qb, 'getRawMany')
          .mockImplementation(() =>
            Promise.resolve([{ userDataId: 30, count: '1', amountCount: '0', totalChf: null }]),
          );
        return qb;
      });

    try {
      await expect(service.getRewardRecipients()).rejects.toThrow(/userDataId 30\b/);
    } finally {
      getRawManySpy?.mockRestore();
      createQueryBuilderSpy.mockRestore();
    }
  });

  it('throws when a group has mixed null and non-null amountInChf, naming the affected userDataId', async () => {
    // Real SQL path (variant b): COUNT(*) vs COUNT(amountInChf) diverge only when some amounts are
    // null; a separate seed keeps seedFixture()'s exact result arrays intact for the four callers.
    const userDataId = await seedMixedAmountGroup();

    await expect(service.getRewardRecipients()).rejects.toThrow(new RegExp(`userDataId ${userDataId}\\b`));
  });

  // The cutoff sits exactly on newDate on purpose, to pin the inclusive >= boundary — a
  // regression to > would drop every newDate row and this test would fail.
  it('filters rewards by from on newDate so group 30 drops the pre-from row (count 1, totalChf 26)', async () => {
    await seedFixture();

    const result = await service.getRewardRecipients(newDate);

    expect(result).toEqual([
      { userDataId: 10, count: 2, totalChf: 300 },
      { userDataId: 20, count: 2, totalChf: 200 },
      { userDataId: 50, count: 1, totalChf: 100 },
      { userDataId: 30, count: 1, totalChf: 26 },
    ]);
    expect(result.map((r) => r.userDataId)).not.toContain(40);
  });

  it('includes rewards on a from date strictly between oldDate and newDate, proving >= is not narrowed to =', async () => {
    await seedFixture();

    const strictlyBetween = new Date('2026-01-01T00:00:00.000Z');
    const result = await service.getRewardRecipients(strictlyBetween);

    // no reward is created exactly on strictlyBetween, so a regression to `r.created = :from`
    // would return an empty list here while `>=` still finds every row at or after it.
    expect(result).toEqual([
      { userDataId: 10, count: 2, totalChf: 300 },
      { userDataId: 20, count: 2, totalChf: 200 },
      { userDataId: 50, count: 1, totalChf: 100 },
      { userDataId: 30, count: 1, totalChf: 26 },
    ]);
    expect(result.map((r) => r.userDataId)).not.toContain(40);
  });

  it('returns an empty list when from is after every reward', async () => {
    await seedFixture();

    // Baseline: confirms the fixture yields data first, so the subsequent empty result comes
    // from the from filter — not from a broken fixture (hard-coded ids / dangling foreign
    // keys).
    const baseline = await service.getRewardRecipients();
    expect(baseline).toHaveLength(4);
    expect(baseline.map((r) => r.userDataId).sort((a, b) => a - b)).toEqual([10, 20, 30, 50]);

    const result = await service.getRewardRecipients(new Date('2030-01-01T00:00:00.000Z'));

    expect(result).toEqual([]);
  });
});
