import { createMock } from '@golevelup/ts-jest';
import { Util } from 'src/shared/utils/util';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../../entities/ledger-account.entity';
import { LedgerLeg } from '../../../entities/ledger-leg.entity';
import { LedgerTx } from '../../../entities/ledger-tx.entity';
import { LedgerAccountRepository } from '../../../repositories/ledger-account.repository';
import { LedgerAccountService } from '../../ledger-account.service';
import { LedgerBookingService } from '../../ledger-booking.service';

/**
 * Shared in-memory ledger harness for the §10.2 evidence-week integration tests. It wires the REAL
 * LedgerBookingService + LedgerAccountService against an in-memory store so cross-consumer balances actually
 * accumulate and net — the unit consumer specs mock the booking service, so they cannot prove that the
 * received/owed/TRANSIT/SUSPENSE liabilities close to 0 ACROSS consumers (the Class-1/2/4 elimination thesis).
 *
 * The store enforces the same single per-tx invariant the service does (Σ amountChfCents = 0 + the sub-cent
 * ROUNDING leg) because the real LedgerBookingService runs unchanged — only its DataSource/manager and the
 * account repository are backed by arrays/maps instead of PostgreSQL. No real DB, no external call.
 */
export class InMemoryLedger {
  readonly accounts = new Map<string, LedgerAccount>();
  readonly txs: LedgerTx[] = [];
  readonly legs: LedgerLeg[] = [];

  readonly bookingService: LedgerBookingService;
  readonly accountService: LedgerAccountService;

  // assetId → account name (so findByAssetId resolves the pre-seeded ASSET accounts)
  private readonly assetIdToName = new Map<number, string>();
  private nextAccountId = 1;
  private nextTxId = 1;
  private nextLegId = 1;

  constructor() {
    const accountRepository = this.buildAccountRepository();
    this.accountService = new LedgerAccountService(accountRepository);
    this.bookingService = new LedgerBookingService(this.buildDataSource(), this.accountService);
  }

  /** seeds an ASSET account with a real assetId so consumers resolve it via findByAssetId (CoA bootstrap stand-in) */
  seedAsset(name: string, currency: string, assetId: number): LedgerAccount {
    const account = this.makeAccount(name, AccountType.ASSET, currency, assetId);
    this.accounts.set(name, account);
    this.assetIdToName.set(assetId, name);
    return account;
  }

  /** seeds a non-ASSET account (ROUNDING/EQUITY/…) the bootstrap creates up-front (§3.4) */
  seed(name: string, type: AccountType, currency: string): LedgerAccount {
    const account = this.makeAccount(name, type, currency);
    this.accounts.set(name, account);
    return account;
  }

  // --- BALANCE QUERIES (the integration assertions read these) --- //

  /** Σ amountChf over all legs of an account by name (CHF balance, signed Dr +/Cr −) */
  chfBalance(name: string): number {
    return Util.round(
      this.legsForAccount(name).reduce((sum, leg) => sum + (leg.amountChf ?? 0), 0),
      2,
    );
  }

  /** Σ amount over all legs of an account by name (native balance, signed) */
  nativeBalance(name: string): number {
    return Util.round(
      this.legsForAccount(name).reduce((sum, leg) => sum + leg.amount, 0),
      8,
    );
  }

  /** true when the account exists in the store (lazy findOrCreate created it) */
  hasAccount(name: string): boolean {
    return this.accounts.has(name);
  }

  /** every booked tx satisfies the single per-tx invariant Σ amountChfCents = 0 (and is a JS number) */
  everyTxBalances(): boolean {
    return this.txs.every((tx) => typeof tx.amountChfSum === 'number' && tx.amountChfSum === 0);
  }

  /**
   * In-memory LedgerTx repository for the cross-consumer gate reads (BuyFiat consumer countBy/findOne, §4.7
   * G-a/G-b). Backs only the read surface those gates use over the shared tx/leg store.
   */
  ledgerTxRepository(): Repository<LedgerTx> {
    const repo = createMock<Repository<LedgerTx>>();

    jest.spyOn(repo, 'countBy').mockImplementation((where: any) => {
      return Promise.resolve(
        this.txs.filter(
          (tx) =>
            (where.sourceType == null || tx.sourceType === where.sourceType) &&
            (where.sourceId == null || tx.sourceId === where.sourceId) &&
            (where.seq == null || tx.seq === where.seq),
        ).length,
      );
    });

    jest.spyOn(repo, 'findOne').mockImplementation(({ where }: any) => {
      const tx = this.txs.find(
        (t) => t.sourceType === where.sourceType && t.sourceId === where.sourceId && t.seq === where.seq,
      );
      if (!tx) return Promise.resolve(null);
      // attach the persisted legs (the gate reads leg.account.name)
      return Promise.resolve(Object.assign(new LedgerTx(), tx, { legs: this.legsForTx(tx.id) }));
    });

    return repo;
  }

  private legsForAccount(name: string): LedgerLeg[] {
    return this.legs.filter((leg) => leg.account?.name === name);
  }

  private legsForTx(txId: number): LedgerLeg[] {
    return this.legs.filter((leg) => leg.tx?.id === txId);
  }

  // --- IN-MEMORY BACKENDS --- //

  private makeAccount(name: string, type: AccountType, currency: string, assetId?: number): LedgerAccount {
    return Object.assign(new LedgerAccount(), {
      id: this.nextAccountId++,
      name,
      type,
      currency,
      assetId,
      asset: assetId != null ? ({ id: assetId } as any) : undefined,
      active: true,
    });
  }

  // backs LedgerAccountService: findOneBy({name}) / findOneBy({asset:{id}}) / create / save
  private buildAccountRepository(): LedgerAccountRepository {
    const repo = createMock<LedgerAccountRepository>();

    jest.spyOn(repo, 'findOneBy').mockImplementation((where: any) => {
      if (where?.name != null) return Promise.resolve(this.accounts.get(where.name) ?? null);
      if (where?.asset?.id != null) {
        const name = this.assetIdToName.get(where.asset.id);
        return Promise.resolve((name != null ? this.accounts.get(name) : null) ?? null);
      }
      return Promise.resolve(null);
    });

    jest.spyOn(repo, 'create').mockImplementation((plain: any) => {
      const assetId = plain?.asset?.id;
      return this.makeAccount(plain.name, plain.type, plain.currency, assetId) as any;
    });

    jest.spyOn(repo, 'save').mockImplementation((account: any) => {
      this.accounts.set(account.name, account);
      if (account.assetId != null) this.assetIdToName.set(account.assetId, account.name);
      return Promise.resolve(account);
    });

    return repo;
  }

  // backs LedgerBookingService: dataSource.transaction (manager.create/save) + getRepository(LedgerTx) for nextSeq
  private buildDataSource(): DataSource {
    const dataSource = createMock<DataSource>();

    jest.spyOn(dataSource, 'transaction').mockImplementation((arg: any) => {
      const manager = createMock<EntityManager>();
      jest.spyOn(manager, 'create').mockImplementation((entity: any, plain: any) => {
        const build = (p: any) => {
          if (entity !== LedgerTx) return Object.assign(new LedgerLeg(), p);
          // mirror the @RelationId(reversalOf) TypeORM populates on load → activeTx (§4.12) reads reversalOfId
          return Object.assign(new LedgerTx(), p, p?.reversalOf?.id != null ? { reversalOfId: p.reversalOf.id } : {});
        };
        return (Array.isArray(plain) ? plain.map(build) : build(plain)) as any;
      });
      jest.spyOn(manager, 'save').mockImplementation((entity: any, value: any) => {
        if (entity === LedgerTx) {
          const tx = value as LedgerTx;
          tx.id = this.nextTxId++;
          this.txs.push(tx);
          return Promise.resolve(tx) as any;
        }
        const legs = value as LedgerLeg[];
        for (const leg of legs) {
          leg.id = this.nextLegId++;
          this.legs.push(leg);
        }
        return Promise.resolve(legs) as any;
      });
      return (arg as (m: EntityManager) => unknown)(manager) as any;
    });

    jest.spyOn(dataSource, 'getRepository').mockReturnValue({
      createQueryBuilder: () => this.nextSeqQueryBuilder(),
      // backs LedgerBookingService.activeTx (§4.12 reversal chain): find all tx of a (sourceType, sourceId) with
      // their legs (+ each leg's account) attached, ordered by seq ASC
      find: ({ where }: any) =>
        Promise.resolve(
          this.txs
            .filter((tx) => tx.sourceType === where.sourceType && tx.sourceId === where.sourceId)
            .sort((a, b) => a.seq - b.seq)
            .map((tx) => Object.assign(new LedgerTx(), tx, { legs: this.legsForTx(tx.id) })),
        ),
    } as any);

    return dataSource;
  }

  // mirrors LedgerBookingService.nextSeq: MAX(seq) for (sourceType, sourceId) over the in-memory tx store
  private nextSeqQueryBuilder(): any {
    let sourceType: string | undefined;
    let sourceId: string | undefined;
    const qb: any = {};
    qb.select = () => qb;
    qb.where = (_expr: string, params: { sourceType: string }) => {
      sourceType = params.sourceType;
      return qb;
    };
    qb.andWhere = (_expr: string, params: { sourceId: string }) => {
      sourceId = params.sourceId;
      return qb;
    };
    qb.getRawOne = () => {
      const seqs = this.txs
        .filter((tx) => tx.sourceType === sourceType && tx.sourceId === sourceId)
        .map((tx) => tx.seq);
      return Promise.resolve({ max: seqs.length ? Math.max(...seqs) : null });
    };
    return qb;
  }
}
