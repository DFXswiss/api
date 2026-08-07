import { createMock } from '@golevelup/ts-jest';
import { DataType, newDb } from 'pg-mem';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { Column, DataSource, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BuyRepository } from '../buy.repository';
import { BuyService } from '../buy.service';

@Entity({ name: 'user_data' })
class UserDataTable {
  @PrimaryGeneratedColumn()
  id: number;

  // the query only touches user_data.id, but an id-only stub makes TypeORM emit
  // INSERT ... DEFAULT VALUES on seeding, which pg-mem cannot parse — so mirror one
  // real column and seed it explicitly
  @Column({ type: 'varchar' })
  kycHash: string;
}

@Entity({ name: 'user' })
class UserTable {
  @PrimaryGeneratedColumn()
  id: number;

  // Explicit varchar: without it TypeORM infers the column type from the TS type, and an enum
  // reflects as Object, which the postgres driver rejects. The real column is character varying too.
  @Column({ type: 'varchar' })
  status: UserStatus;

  @ManyToOne(() => UserDataTable, { nullable: false, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'userDataId' })
  userData: UserDataTable;
}

@Entity({ name: 'asset' })
class AssetTable {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'boolean' })
  buyable: boolean;
}

@Entity({ name: 'buy' })
class BuyTable {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'boolean' })
  active: boolean;

  @ManyToOne(() => UserTable, { nullable: false, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'userId' })
  user: UserTable;

  @ManyToOne(() => AssetTable, { nullable: false, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'assetId' })
  asset: AssetTable;
}

interface Fixture {
  userData1: UserDataTable;
  userA: UserTable;
  userC: UserTable;
  buyA: BuyTable;
  buyB: BuyTable;
}

// runs getUserDataBuys against a Postgres-semantics engine (pg-mem), because mocked find() calls
// never execute SQL; this pins the real filter and join semantics for the user relation, nested
// where conditions including Not(In([...])) on user.status, asset.buyable, active, and the optional
// user id restriction when userId is provided
describe('BuyService.getUserDataBuys (postgres semantics)', () => {
  let dataSource: DataSource;
  let repo: BuyRepository;
  let service: BuyService;

  beforeAll(async () => {
    const db = newDb();
    // TypeORM runs SELECT version() / current_database() on connect; pg-mem does not ship them
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });

    dataSource = (await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [UserDataTable, UserTable, AssetTable, BuyTable],
      synchronize: true,
    })) as DataSource;
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.getRepository(BuyTable).clear();
    await dataSource.getRepository(AssetTable).clear();
    await dataSource.getRepository(UserTable).clear();
    await dataSource.getRepository(UserDataTable).clear();

    repo = dataSource.getRepository(BuyTable) as unknown as BuyRepository;
    service = new BuyService(
      repo,
      createMock<UserService>(),
      createMock<RouteService>(),
      createMock<PaymentInfoService>(),
      createMock<SwissQRService>(),
      createMock<BankService>(),
      createMock<TransactionRequestService>(),
      createMock<TransactionHelper>(),
      createMock<CheckoutService>(),
      createMock<VirtualIbanService>(),
    );
  });

  async function seedFixture(): Promise<Fixture> {
    const userDataRepo = dataSource.getRepository(UserDataTable);
    const userRepo = dataSource.getRepository(UserTable);
    const assetRepo = dataSource.getRepository(AssetTable);
    const buyRepo = dataSource.getRepository(BuyTable);

    const [userData1, userData2] = await userDataRepo.save([{ kycHash: 'hash-1' }, { kycHash: 'hash-2' }]);
    const [userA, userB, userC, userD, userE] = await userRepo.save([
      { userData: userData1, status: UserStatus.ACTIVE },
      { userData: userData1, status: UserStatus.ACTIVE },
      { userData: userData1, status: UserStatus.BLOCKED },
      { userData: userData2, status: UserStatus.ACTIVE },
      { userData: userData1, status: UserStatus.DELETED },
    ]);
    const [assetBuyable, assetNotBuyable] = await assetRepo.save([{ buyable: true }, { buyable: false }]);
    const [buyA, buyB] = await buyRepo.save([
      { user: userA, asset: assetBuyable, active: true },
      { user: userB, asset: assetBuyable, active: true },
      { user: userC, asset: assetBuyable, active: true },
      { user: userA, asset: assetBuyable, active: false },
      { user: userB, asset: assetNotBuyable, active: true },
      { user: userD, asset: assetBuyable, active: true },
      { user: userE, asset: assetBuyable, active: true },
    ]);

    return { userData1, userA, userC, buyA, buyB };
  }

  it('returns every eligible buy of the account without a userId', async () => {
    const { userData1, buyA, buyB } = await seedFixture();

    const buys = await service.getUserDataBuys(userData1.id);
    expect(buys.map((b) => b.id).sort((x, y) => x - y)).toEqual([buyA.id, buyB.id].sort((x, y) => x - y));
    expect(buys.every((b) => b.user != null)).toBe(true);
  });

  it('returns only the buys of the given user with a userId', async () => {
    const { userData1, userA, buyA } = await seedFixture();

    const buys = await service.getUserDataBuys(userData1.id, userA.id);
    expect(buys.map((b) => b.id)).toEqual([buyA.id]);
  });

  it('returns an empty list for a user of the account without eligible buys', async () => {
    const { userData1, userC } = await seedFixture();

    const buys = await service.getUserDataBuys(userData1.id, userC.id);
    expect(buys).toEqual([]);
  });
});
