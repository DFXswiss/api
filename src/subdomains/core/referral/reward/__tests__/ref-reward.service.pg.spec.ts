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

  @Column({ nullable: true })
  status?: string;

  // Relation path for `.innerJoin('r.user', ...)`; createForeignKeyConstraints is false so seed
  // order is unconstrained.
  @ManyToOne(() => UserTable, { nullable: false, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'userId' })
  user: UserTable;
}

function normalizeRecipients(
  rows: { userDataId: number; count: number; totalChf: number }[],
): { userDataId: number; count: number; totalChf: number }[] {
  return rows.map((row) => ({
    userDataId: Number(row.userDataId),
    count: Number(row.count),
    totalChf: Number(row.totalChf),
  }));
}

// runs getRewardRecipients against a Postgres-semantics engine (pg-mem) to verify the ORDER BY
// alias quoting and aggregation semantics, because a mocked query builder never executes SQL and
// an unquoted orderBy('totalChf') would otherwise go unnoticed (column "totalchf" does not exist)
describe('RefRewardService.getRewardRecipients (postgres semantics)', () => {
  let dataSource: DataSource;
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

    service = new RefRewardService(
      dataSource.getRepository(RefRewardTable) as unknown as RefRewardRepository,
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

    // userDataId 10: COMPLETE 100 + 200 → totalChf 300, count 2 (highest)
    // userDataId 20: COMPLETE 150 → totalChf 150, count 1
    // userDataId 30: COMPLETE 50 + COMPLETE 25 → totalChf 75, count 2 (two rows aggregate)
    // userDataId 40: only USER_SWITCH → must not appear
    // userDataId 50: COMPLETE 100 + USER_SWITCH 999 → totalChf 100, count 1 (USER_SWITCH excluded)
    await userRepo.save([
      { id: 1, userDataId: 10 },
      { id: 2, userDataId: 20 },
      { id: 3, userDataId: 30 },
      { id: 4, userDataId: 40 },
      { id: 5, userDataId: 50 },
    ]);

    await rewardRepo.save([
      { created: newDate, amountInChf: 100, status: RewardStatus.COMPLETE, user: { id: 1 } },
      { created: newDate, amountInChf: 200, status: RewardStatus.COMPLETE, user: { id: 1 } },
      { created: newDate, amountInChf: 150, status: RewardStatus.COMPLETE, user: { id: 2 } },
      { created: oldDate, amountInChf: 50, status: RewardStatus.COMPLETE, user: { id: 3 } },
      { created: newDate, amountInChf: 25, status: RewardStatus.COMPLETE, user: { id: 3 } },
      { created: newDate, amountInChf: 500, status: RewardStatus.USER_SWITCH, user: { id: 4 } },
      { created: newDate, amountInChf: 100, status: RewardStatus.COMPLETE, user: { id: 5 } },
      { created: newDate, amountInChf: 999, status: RewardStatus.USER_SWITCH, user: { id: 5 } },
    ]);
  }

  it('returns recipients sorted by totalChf DESC, excluding USER_SWITCH from sum/count and pure USER_SWITCH recipients', async () => {
    await seedFixture();

    // must not throw (the prod bug: QueryFailedError: column "totalchf" does not exist)
    const result = await service.getRewardRecipients();
    const normalized = normalizeRecipients(result);

    expect(normalized).toEqual([
      { userDataId: 10, count: 2, totalChf: 300 },
      { userDataId: 20, count: 1, totalChf: 150 },
      { userDataId: 50, count: 1, totalChf: 100 },
      { userDataId: 30, count: 2, totalChf: 75 },
    ]);
    expect(normalized.map((r) => r.userDataId)).not.toContain(40);
    expect(normalized.every((row, i) => i === 0 || normalized[i - 1].totalChf >= row.totalChf)).toBe(true);
  });

  // The optional `from` filter is deliberately not covered here: pg-mem does not compare timestamp
  // columns against JS Date parameters reliably, so such a test would fail for a reason that has
  // nothing to do with this service. The filter is a plain andWhere on an indexed column; the case
  // this file exists for — the ORDER BY alias against real Postgres identifier folding — is covered
  // by the test above, which fails with `column "totalchf" does not exist` if the fix is reverted.
});
