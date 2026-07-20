import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { DataSource, EntityManager } from 'typeorm';
import { AccountType } from '../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../entities/__mocks__/ledger-account.entity.mock';
import { createCustomLedgerLeg } from '../../entities/__mocks__/ledger-leg.entity.mock';
import { createCustomLedgerTx } from '../../entities/__mocks__/ledger-tx.entity.mock';
import { LedgerTx } from '../../entities/ledger-tx.entity';
import { LedgerLeg } from '../../entities/ledger-leg.entity';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput } from '../ledger-booking.service';

describe('LedgerBookingService', () => {
  let service: LedgerBookingService;

  let dataSource: DataSource;
  let ledgerAccountService: LedgerAccountService;
  let assetService: AssetService;

  let savedLegs: LedgerLeg[];

  const walletAsset = createCustomLedgerAccount({
    id: 10,
    name: 'Binance/BTC',
    type: AccountType.ASSET,
    currency: 'BTC',
  });
  const exchangeAsset = createCustomLedgerAccount({
    id: 11,
    name: 'Scrypt/BTC',
    type: AccountType.ASSET,
    currency: 'BTC',
  });
  const liability = createCustomLedgerAccount({
    id: 20,
    name: 'LIABILITY/buyFiat-received',
    type: AccountType.LIABILITY,
    currency: 'CHF',
  });
  const roundingAccount = createCustomLedgerAccount({
    id: 99,
    name: 'ROUNDING',
    type: AccountType.ROUNDING,
    currency: 'CHF',
  });
  const chfBank = createCustomLedgerAccount({
    id: 30,
    name: 'Bank/CHF',
    type: AccountType.ASSET,
    currency: 'CHF',
  });
  const chfPayout = createCustomLedgerAccount({
    id: 31,
    name: 'TRANSIT/payout/CHF',
    type: AccountType.TRANSIT,
    currency: 'CHF',
  });

  beforeEach(async () => {
    savedLegs = [];

    dataSource = createMock<DataSource>();
    ledgerAccountService = createMock<LedgerAccountService>();
    assetService = createMock<AssetService>();
    jest.spyOn(assetService, 'getAssetsById').mockResolvedValue([]); // default: no asset decimals → amountBaseUnits null

    // mock transaction: invoke callback with a manager that echoes create/save
    jest.spyOn(dataSource, 'transaction').mockImplementation((arg: any) => {
      const runInTransaction = typeof arg === 'function' ? arg : arg;
      const manager = createMock<EntityManager>();
      jest.spyOn(manager, 'create').mockImplementation((_entity: any, plain: any) => {
        const isArray = Array.isArray(plain);
        const build = (p: any) =>
          _entity === LedgerTx ? Object.assign(new LedgerTx(), p) : Object.assign(new LedgerLeg(), p);
        return (isArray ? plain.map(build) : build(plain)) as any;
      });
      jest.spyOn(manager, 'save').mockImplementation((_entity: any, value: any) => {
        if (_entity === LedgerLeg) savedLegs = value as LedgerLeg[];
        return Promise.resolve(value) as any;
      });
      // §4.12 (F2): the manager-scoped seq allocation reads through manager.getRepository → delegate to whatever
      // dataSource.getRepository a test sets, so the in-transaction seq read sees the same source of truth
      jest.spyOn(manager, 'getRepository').mockImplementation((entity: any) => dataSource.getRepository(entity));
      return runInTransaction(manager) as any;
    });

    jest.spyOn(ledgerAccountService, 'findByName').mockResolvedValue(roundingAccount);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestUtil.provideConfig(),
        LedgerBookingService,
        { provide: DataSource, useValue: dataSource },
        { provide: LedgerAccountService, useValue: ledgerAccountService },
        { provide: AssetService, useValue: assetService },
      ],
    }).compile();

    service = module.get<LedgerBookingService>(LedgerBookingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // #4280 native-first (phase 1): every asset-backed leg additionally carries the EXACT integer base-unit quantity
  // (amount × 10^asset.decimals); a fiat/assetId-less leg stays null (CHF-exact via amountChfCents).
  it('sets amountBaseUnits to exact integer base units for an asset leg (null for a fiat leg)', async () => {
    const btcAsset = createCustomLedgerAccount({
      id: 15,
      name: 'Kraken/BTC',
      type: AccountType.ASSET,
      currency: 'BTC',
      assetId: 70,
    });
    jest.spyOn(assetService, 'getAssetsById').mockResolvedValue([{ id: 70, decimals: 8 } as any]);

    await service.bookTx({
      sourceType: 'crypto_input',
      sourceId: 'bu1',
      seq: 0,
      bookingDate: new Date('2026-06-01'),
      legs: [
        { account: btcAsset, amount: 1, priceChf: 50000, amountChf: 50000 },
        { account: liability, amount: -50000, amountChf: -50000 },
      ],
    });

    const btcLeg = savedLegs.find((l) => l.account.name === 'Kraken/BTC');
    const fiatLeg = savedLegs.find((l) => l.account.name === 'LIABILITY/buyFiat-received');
    expect(btcLeg?.amountBaseUnits).toBe(100000000n); // 1 BTC = 1e8 satoshi, exact integer
    expect(fiatLeg?.amountBaseUnits).toBeNull(); // fiat/assetId-less → null
    expect(assetService.getAssetsById).toHaveBeenCalledWith([70]); // only asset-backed accounts looked up
  });

  // nextSeq `(max ?? -1) + 1` (line 235): an empty (sourceType,sourceId) namespace → MAX(seq) is null → nextSeq 0.
  // nextCorrectionSeq then lifts it into the reserved correction range. Proves seq allocation starts at 0, not NaN.
  it('allocates seq 0 for an empty source namespace (MAX(seq) null → ?? -1)', async () => {
    const qb: any = {
      select: () => qb,
      where: () => qb,
      andWhere: () => qb,
      getRawOne: () => Promise.resolve({ max: null }), // no existing tx for the source
    };
    jest.spyOn(dataSource, 'getRepository').mockReturnValue({ createQueryBuilder: () => qb } as any);

    expect(await service.nextSeq('bank_tx', '404')).toBe(0); // (null ?? -1) + 1 = 0
    expect(await service.nextCorrectionSeq('bank_tx', '404')).toBe(1_000_000); // lifted into the correction range
  });

  it('books a balanced cross-asset tx with amountChfSum === 0', async () => {
    const legs: LedgerLegInput[] = [
      { account: walletAsset, amount: 1, priceChf: 50000, amountChf: 50000 },
      { account: liability, amount: -50000, amountChf: -50000 },
    ];

    const tx = await service.bookTx({
      sourceType: 'crypto_input',
      sourceId: '1',
      seq: 0,
      bookingDate: new Date('2026-06-01'),
      legs,
    });

    expect(tx.amountChfSum).toBe(0);
    expect(typeof tx.amountChfSum).toBe('number'); // JS number, never a raw bigint string (bigint column → chfCentsTransformer, Blocker R1-4)
    expect(savedLegs).toHaveLength(2);
    expect(savedLegs.reduce((s, l) => s + l.amountChfCents, 0)).toBe(0); // real addition, no string concat
    expect(savedLegs.map((l) => l.amountChfCents)).toEqual([5000000, -5000000]);
  });

  it('appends a sub-cent ROUNDING leg when CHF rest is within tolerance', async () => {
    const legs: LedgerLegInput[] = [
      { account: walletAsset, amount: 1, priceChf: 50000.01, amountChf: 50000.01 },
      { account: liability, amount: -50000, amountChf: -50000 },
    ];

    const tx = await service.bookTx({
      sourceType: 'crypto_input',
      sourceId: '2',
      seq: 0,
      bookingDate: new Date('2026-06-01'),
      legs,
    });

    expect(tx.amountChfSum).toBe(0);
    expect(savedLegs).toHaveLength(3);

    const rounding = savedLegs.find((l) => l.account.type === AccountType.ROUNDING);
    expect(rounding).toBeDefined();
    expect(rounding.amount).toBe(0);
    expect(rounding.priceChf).toBeNull();
    expect(rounding.amountChfCents).toBe(-1); // closes 50000.01 ↔ -50000 (1 cent)
    expect(savedLegs.reduce((s, l) => s + l.amountChfCents, 0)).toBe(0);
  });

  it('throws when CHF imbalance exceeds the rounding tolerance (structural spread not plugged)', async () => {
    const legs: LedgerLegInput[] = [
      { account: walletAsset, amount: 1, priceChf: 50050, amountChf: 50050 },
      { account: liability, amount: -50000, amountChf: -50000 },
    ];

    await expect(
      service.bookTx({ sourceType: 'crypto_input', sourceId: '3', seq: 0, bookingDate: new Date('2026-06-01'), legs }),
    ).rejects.toThrow(/imbalance/i);

    expect(savedLegs).toHaveLength(0); // tx not booked
  });

  // A non-finite leg must fail in prepareLeg before any persist — never surface as Postgres bigint "NaN".
  it('throws refuse-to-book for a non-finite amountChf and does not persist', async () => {
    const legs: LedgerLegInput[] = [
      { account: walletAsset, amount: 1, priceChf: 50000, amountChf: NaN },
      { account: liability, amount: -50000, amountChf: -50000 },
    ];

    await expect(
      service.bookTx({
        sourceType: 'crypto_input',
        sourceId: 'nan',
        seq: 0,
        bookingDate: new Date('2026-06-01'),
        legs,
      }),
    ).rejects.toThrow(/refusing to book/);

    expect(savedLegs).toHaveLength(0); // nothing persisted
  });

  // #4280 native-first (phase 1): the native-balance invariant is scoped to pure same-asset transfers (all legs
  // ASSET/TRANSIT of ONE currency). A value-boundary tx (a leg on any other account type — here a LIABILITY) is out
  // of scope, so its correct native one-sidedness is left alone (no throw).
  it('does not apply the native-balance invariant to a value-boundary tx (asset ↔ liability)', async () => {
    await service.bookTx({
      sourceType: 'crypto_input',
      sourceId: '4',
      seq: 0,
      bookingDate: new Date('2026-06-01'),
      legs: [
        { account: walletAsset, amount: 1, priceChf: 50000, amountChf: 50000 }, // BTC one-sided, correct
        { account: liability, amount: -50000, amountChf: -50000 },
      ],
    });

    expect(savedLegs.length).toBeGreaterThan(0); // liability leg → not ASSET/TRANSIT-only → invariant skipped → booked
  });

  // #4280 native-first (phase 1): a same-currency ASSET↔TRANSIT transfer conserves EXACTLY in base units — the TRANSIT
  // counter (no assetId) is keyed off the paired asset's decimals so the pair cancels to 0n → assertNativeBalance
  // passes and the tx books.
  it('books a same-currency ASSET↔TRANSIT transfer that conserves exactly in base units (no throw)', async () => {
    const btcExchange = createCustomLedgerAccount({
      id: 15,
      name: 'Kraken/BTC',
      type: AccountType.ASSET,
      currency: 'BTC',
      assetId: 70,
    });
    const btcTransit = createCustomLedgerAccount({
      id: 16,
      name: 'TRANSIT/withdrawal/BTC',
      type: AccountType.TRANSIT,
      currency: 'BTC',
    });
    jest.spyOn(assetService, 'getAssetsById').mockResolvedValue([{ id: 70, decimals: 8 } as any]);

    await service.bookTx({
      sourceType: 'exchange_tx',
      sourceId: 't1',
      seq: 0,
      bookingDate: new Date('2026-06-01'),
      legs: [
        { account: btcExchange, amount: -0.5, priceChf: 50000, amountChf: -25000 },
        { account: btcTransit, amount: 0.5, priceChf: 50000, amountChf: 25000 },
      ],
    });

    const assetLeg = savedLegs.find((l) => l.account.name === 'Kraken/BTC');
    const transitLeg = savedLegs.find((l) => l.account.name === 'TRANSIT/withdrawal/BTC');
    expect(assetLeg?.amountBaseUnits).toBe(-50000000n); // -0.5 BTC
    expect(transitLeg?.amountBaseUnits).toBe(50000000n); // counter keyed off the paired asset's 8 decimals
    expect((assetLeg!.amountBaseUnits as bigint) + (transitLeg!.amountBaseUnits as bigint)).toBe(0n); // pair cancels
  });

  // #4280 native-first (phase 1): a synthetic same-asset (single-currency) tx whose exact base units do NOT net to 0
  // is a real imbalance and THROWS (fail-closed) — even though its CHF nets to 0 via divergent marks. Nothing persists.
  it('throws on a synthetic same-asset base-unit imbalance and does not persist', async () => {
    const btcA = createCustomLedgerAccount({
      id: 15,
      name: 'Kraken/BTC',
      type: AccountType.ASSET,
      currency: 'BTC',
      assetId: 70,
    });
    const btcB = createCustomLedgerAccount({
      id: 16,
      name: 'Scrypt/BTC',
      type: AccountType.ASSET,
      currency: 'BTC',
      assetId: 70,
    });
    jest.spyOn(assetService, 'getAssetsById').mockResolvedValue([{ id: 70, decimals: 8 } as any]);

    await expect(
      service.bookTx({
        sourceType: 'exchange_tx',
        sourceId: 't2',
        seq: 0,
        bookingDate: new Date('2026-07-17'),
        legs: [
          { account: btcA, amount: 2, priceChf: 25000, amountChf: 50000 },
          { account: btcB, amount: -1, priceChf: 50000, amountChf: -50000 }, // CHF nets to 0; base units +1e8 ≠ 0
        ],
      }),
    ).rejects.toThrow(/base-unit imbalance/i);

    expect(savedLegs).toHaveLength(0); // fail-closed: nothing persisted
  });

  // #4280 native-first (phase 1) / retained escape (b): a single-currency CHF settlement with sub-rappen native noise
  // (the bank ASSET leg carries the unrounded output at >2 dp) does NOT throw — fiat = null decimals → null base units
  // → escape (a): a scope with no base-unit-bearing legs has nothing to enforce exactly.
  it('does NOT throw on sub-rappen fiat rounding in a single-currency CHF settlement (no base units in scope)', async () => {
    await service.bookTx({
      sourceType: 'buy_fiat',
      sourceId: '8',
      seq: 3,
      bookingDate: new Date('2026-07-17'),
      legs: [
        { account: chfPayout, amount: 3303.62, priceChf: 1, amountChf: 3303.62 },
        { account: chfBank, amount: -3303.6168978, priceChf: 1, amountChf: -3303.62 }, // unrounded native output
      ],
    });

    expect(savedLegs.length).toBeGreaterThan(0); // booked
    expect(savedLegs.every((l) => l.amountBaseUnits == null)).toBe(true); // fiat legs → null base units → escape (a)
  });

  // #4280 native-first (phase 1): a cross-asset trade (two currencies) is out of scope — its per-currency native delta
  // IS the trade, never 0 — so assertNativeBalance never fires and the tx books.
  it('does NOT throw on a cross-asset trade (two currencies out of scope)', async () => {
    const btc = createCustomLedgerAccount({
      id: 15,
      name: 'Kraken/BTC',
      type: AccountType.ASSET,
      currency: 'BTC',
      assetId: 70,
    });
    const usdt = createCustomLedgerAccount({
      id: 17,
      name: 'Kraken/USDT',
      type: AccountType.ASSET,
      currency: 'USDT',
      assetId: 71,
    });
    jest
      .spyOn(assetService, 'getAssetsById')
      .mockResolvedValue([{ id: 70, decimals: 8 } as any, { id: 71, decimals: 6 } as any]);

    await service.bookTx({
      sourceType: 'exchange_tx',
      sourceId: 't4',
      seq: 0,
      bookingDate: new Date('2026-07-17'),
      legs: [
        { account: btc, amount: 0.00008, priceChf: 50000, amountChf: 4 },
        { account: usdt, amount: -5, priceChf: 0.8, amountChf: -4 }, // different currency → outside scope
      ],
    });

    expect(savedLegs.length).toBeGreaterThan(0); // two currencies → invariant skipped → booked
  });

  // #4280 native-first (phase 1) / FIX B: a SAME-ticker CROSS-CHAIN transfer (USDT on ETH = 6dp, USDT on BSC = 18dp,
  // two assetIds, one currency 'USDT') that CONSERVES natively (+100 / −100) must NOT throw. Its base units live at
  // incommensurable scales (1e8 vs 1e20) → summing them (1e8 − 1e20 ≠ 0) would fail-closed and wedge a legitimate
  // booking; the mixed-decimals guard (ASSET legs span two distinct decimals) skips the exact throw and the retained
  // soft native-float check nets +100 − 100 = 0 → books.
  it('does NOT throw on a same-ticker cross-chain transfer with differing decimals (conserves natively)', async () => {
    const usdtEth = createCustomLedgerAccount({
      id: 15,
      name: 'Kraken/USDT-ETH',
      type: AccountType.ASSET,
      currency: 'USDT',
      assetId: 71,
    });
    const usdtBsc = createCustomLedgerAccount({
      id: 16,
      name: 'Scrypt/USDT-BSC',
      type: AccountType.ASSET,
      currency: 'USDT',
      assetId: 72,
    });
    jest
      .spyOn(assetService, 'getAssetsById')
      .mockResolvedValue([{ id: 71, decimals: 6 } as any, { id: 72, decimals: 18 } as any]);

    await service.bookTx({
      sourceType: 'exchange_tx',
      sourceId: 't5',
      seq: 0,
      bookingDate: new Date('2026-07-17'),
      legs: [
        { account: usdtEth, amount: 100, priceChf: 0.9, amountChf: 90 }, // +100 USDT-ETH → 1e8 base units (6dp)
        { account: usdtBsc, amount: -100, priceChf: 0.9, amountChf: -90 }, // −100 USDT-BSC → −1e20 base units (18dp)
      ],
    });

    expect(savedLegs.length).toBeGreaterThan(0); // mixed decimals → soft native check nets to 0 → booked, no throw
    const ethLeg = savedLegs.find((l) => l.account.name === 'Kraken/USDT-ETH');
    const bscLeg = savedLegs.find((l) => l.account.name === 'Scrypt/USDT-BSC');
    expect(ethLeg?.amountBaseUnits).toBe(100000000n); // 100 × 10^6
    expect(bscLeg?.amountBaseUnits).toBe(-100000000000000000000n); // −100 × 10^18 (incommensurable with the 6dp leg)
  });

  // #4280 native-first (phase 1) / residual fail-closed corner: a SAME-ticker transfer that pairs a decimals-bearing
  // ASSET leg (8dp) with a null-decimals ASSET leg of the SAME ticker (its asset defines no decimals → amountBaseUnits
  // null) and CONSERVES natively (+100 / −100) must NOT throw. The null-decimals sibling is excluded from `valued`, so
  // summing only the 8dp leg (+1e10 ≠ 0) would FALSE-throw (fail-closed) — the `!valued.length` escape doesn't fire
  // because one leg IS valued. A null-decimals ASSET leg makes the scope ambiguous → treated as mixed → the retained
  // soft native-float check nets +100 − 100 = 0 → books. (Reverting the `!hasNullDecimalsAsset` guard makes this throw.)
  it('does NOT throw on a same-ticker transfer pairing an 8dp asset leg with a null-decimals asset leg (conserves natively)', async () => {
    const usdtValued = createCustomLedgerAccount({
      id: 15,
      name: 'Kraken/USDT-8dp',
      type: AccountType.ASSET,
      currency: 'USDT',
      assetId: 73,
    });
    const usdtNullDecimals = createCustomLedgerAccount({
      id: 16,
      name: 'Custody/USDT-nodecimals',
      type: AccountType.ASSET,
      currency: 'USDT',
      assetId: 74,
    });
    // asset 74 defines no decimals → filtered out of decimalsById → decimalsById.get(74) is undefined → base units null
    jest
      .spyOn(assetService, 'getAssetsById')
      .mockResolvedValue([{ id: 73, decimals: 8 } as any, { id: 74, decimals: null } as any]);

    await service.bookTx({
      sourceType: 'exchange_tx',
      sourceId: 't6',
      seq: 0,
      bookingDate: new Date('2026-07-17'),
      legs: [
        { account: usdtValued, amount: 100, priceChf: 0.9, amountChf: 90 }, // +100 → 1e10 base units (8dp)
        { account: usdtNullDecimals, amount: -100, priceChf: 0.9, amountChf: -90 }, // −100 → null base units (no decimals)
      ],
    });

    expect(savedLegs.length).toBeGreaterThan(0); // null-decimals sibling → ambiguous scope → soft native check → booked, no throw
    const valuedLeg = savedLegs.find((l) => l.account.name === 'Kraken/USDT-8dp');
    const nullLeg = savedLegs.find((l) => l.account.name === 'Custody/USDT-nodecimals');
    expect(valuedLeg?.amountBaseUnits).toBe(10000000000n); // 100 × 10^8
    expect(nullLeg?.amountBaseUnits).toBeNull(); // asset defines no decimals → null (excluded from the base-unit sum)
  });

  it('reverses a tx with inverted legs and the next free seq', async () => {
    jest.spyOn(dataSource, 'getRepository').mockReturnValue({
      createQueryBuilder: () => ({
        select: () => ({
          where: () => ({
            andWhere: () => ({ getRawOne: () => Promise.resolve({ max: 1 }) }),
          }),
        }),
      }),
    } as any);

    const original = createCustomLedgerTx({
      id: 7,
      sourceType: 'bank_tx',
      sourceId: '202000',
      seq: 0,
      legs: [
        createCustomLedgerLeg({
          account: walletAsset,
          amount: 1,
          priceChf: 50000,
          amountChf: 50000,
          amountChfCents: 5000000,
        }),
        createCustomLedgerLeg({ account: liability, amount: -50000, amountChf: -50000, amountChfCents: -5000000 }),
      ],
    });

    const reversal = await service.reverseTx(original);

    expect(reversal.seq).toBe(1_000_000); // reversal lives in the reserved correction range (§4.12 eigener Namespace)
    expect(reversal.reversalOf).toBe(original);
    expect(reversal.amountChfSum).toBe(0);
    expect(savedLegs.map((l) => l.amountChfCents)).toEqual([-5000000, 5000000]); // inverted
  });

  describe('reverseAndRebookIfChanged (§4.12 content-change cycle)', () => {
    // an in-memory ledger_tx store the service reads via getRepository(LedgerTx).find / .createQueryBuilder(nextSeq)
    // and writes via dataSource.transaction (manager.create/save). Lets the full reversal cycle run for real.
    let txStore: LedgerTx[];
    let nextId: number;

    beforeEach(() => {
      txStore = [];
      nextId = 1;

      // capture booked tx into the store so activeTx/nextSeq see the running state
      jest.spyOn(dataSource, 'transaction').mockImplementation((arg: any) => {
        const manager = createMock<EntityManager>();
        jest.spyOn(manager, 'create').mockImplementation((entity: any, plain: any) => {
          const build = (p: any) =>
            entity === LedgerTx
              ? Object.assign(new LedgerTx(), p, p?.reversalOf?.id != null ? { reversalOfId: p.reversalOf.id } : {})
              : Object.assign(new LedgerLeg(), p);
          return (Array.isArray(plain) ? plain.map(build) : build(plain)) as any;
        });
        jest.spyOn(manager, 'save').mockImplementation((entity: any, value: any) => {
          if (entity === LedgerTx) {
            const tx = value as LedgerTx;
            tx.id = nextId++;
            txStore.push(tx);
            return Promise.resolve(tx) as any;
          }
          // attach legs to their tx (so a later find returns them)
          const legs = value as LedgerLeg[];
          for (const leg of legs) (leg.tx.legs ??= []).push(leg);
          savedLegs = legs;
          return Promise.resolve(legs) as any;
        });
        // §4.12 (F2): the in-transaction seq read goes through manager.getRepository → delegate to the store-backed
        // dataSource.getRepository so the re-book's seq allocation sees the uncommitted reversal (reversal.seq + 1)
        jest.spyOn(manager, 'getRepository').mockImplementation((entity: any) => dataSource.getRepository(entity));
        return (arg as (m: EntityManager) => unknown)(manager) as any;
      });

      jest.spyOn(dataSource, 'getRepository').mockReturnValue({
        find: ({ where }: any) =>
          Promise.resolve(
            txStore
              .filter((tx) => tx.sourceType === where.sourceType && tx.sourceId === where.sourceId)
              .sort((a, b) => a.seq - b.seq),
          ),
        // hasAnyTxAt: any tx exists at the exact (sourceType, sourceId, seq)
        existsBy: (where: any) =>
          Promise.resolve(
            txStore.some(
              (tx) => tx.sourceType === where.sourceType && tx.sourceId === where.sourceId && tx.seq === where.seq,
            ),
          ),
        createQueryBuilder: () => {
          let st: string, sid: string;
          const qb: any = {};
          qb.select = () => qb;
          qb.where = (_e: string, p: any) => ((st = p.sourceType), qb);
          qb.andWhere = (_e: string, p: any) => ((sid = p.sourceId), qb);
          qb.getRawOne = () => {
            const seqs = txStore.filter((t) => t.sourceType === st && t.sourceId === sid).map((t) => t.seq);
            return Promise.resolve({ max: seqs.length ? Math.max(...seqs) : null });
          };
          return qb;
        },
      } as any);
    });

    const seq0Input = (amountChf: number) => ({
      sourceType: 'bank_tx',
      sourceId: '900',
      seq: 0,
      bookingDate: new Date('2026-06-01'),
      legs: [
        { account: walletAsset, amount: 1, priceChf: amountChf, amountChf },
        { account: liability, amount: -amountChf, priceChf: 1, amountChf: -amountChf },
      ],
    });

    it('books a reversal + re-book when a leg amount changed beyond tolerance; seq strictly monotonic', async () => {
      await service.bookTx(seq0Input(50000)); // seq0

      const changed = await service.reverseAndRebookIfChanged(seq0Input(60000)); // amountChf changed
      expect(changed).toBe(true);

      const all = txStore.filter((t) => t.sourceId === '900').sort((a, b) => a.seq - b.seq);
      // §4.12 "eigener seq-Namespace": the forward seq0 stays, reversal + re-book live in the reserved correction
      // range (≥ 1_000_000) so they never collide with a not-yet-booked forward seq of a multi-seq source (R3).
      expect(all.map((t) => t.seq)).toEqual([0, 1_000_000, 1_000_001]); // strictly monotone over the cycle
      expect(all[1].reversalOfId).toBe(all[0].id); // the reversal reverses the ORIGINAL seq0
      expect(all[2].reversalOfId).toBeUndefined(); // the re-book is a new valid booking
    });

    // §4.12 (F2): reversal + re-book run in ONE transaction. A crash DURING the re-book (after the reversal was
    // written) must roll BOTH back — otherwise a flat-reversal state persists and the next forward run collides on
    // the original seq0 (a UNIQUE loop). The transaction mock here is ATOMIC: tx saved in the callback are buffered
    // and only flushed to txStore when the callback RESOLVES; a throw discards the buffer (models a real ROLLBACK).
    it('rolls back BOTH the reversal and the re-book when the re-book save crashes (one-transaction atomicity)', async () => {
      await service.bookTx(seq0Input(50000)); // committed forward seq0 (via the describe's default tx mock)

      let ledgerTxSaves = 0;
      jest.spyOn(dataSource, 'transaction').mockImplementation(async (arg: any) => {
        const buffer: LedgerTx[] = [];
        const manager = createMock<EntityManager>();
        jest.spyOn(manager, 'create').mockImplementation((entity: any, plain: any) => {
          const build = (p: any) =>
            entity === LedgerTx
              ? Object.assign(new LedgerTx(), p, p?.reversalOf?.id != null ? { reversalOfId: p.reversalOf.id } : {})
              : Object.assign(new LedgerLeg(), p);
          return (Array.isArray(plain) ? plain.map(build) : build(plain)) as any;
        });
        jest.spyOn(manager, 'save').mockImplementation((entity: any, value: any) => {
          if (entity === LedgerTx) {
            if (++ledgerTxSaves === 2) return Promise.reject(new Error('re-book save crashed')); // 2nd = the re-book
            const tx = value as LedgerTx;
            tx.id = nextId++;
            buffer.push(tx); // buffered, NOT yet visible in txStore
            return Promise.resolve(tx) as any;
          }
          const legs = value as LedgerLeg[];
          for (const leg of legs) (leg.tx.legs ??= []).push(leg);
          savedLegs = legs;
          return Promise.resolve(legs) as any;
        });
        // seq reads inside the tx see txStore + the buffered (uncommitted) reversal → the re-book gets reversal.seq + 1
        jest.spyOn(manager, 'getRepository').mockReturnValue({
          createQueryBuilder: () => {
            let st: string, sid: string;
            const qb: any = {};
            qb.select = () => qb;
            qb.where = (_e: string, p: any) => ((st = p.sourceType), qb);
            qb.andWhere = (_e: string, p: any) => ((sid = p.sourceId), qb);
            qb.getRawOne = () => {
              const seqs = [...txStore, ...buffer]
                .filter((t) => t.sourceType === st && t.sourceId === sid)
                .map((t) => t.seq);
              return Promise.resolve({ max: seqs.length ? Math.max(...seqs) : null });
            };
            return qb;
          },
        } as any);

        const result = await (arg as (m: EntityManager) => unknown)(manager);
        txStore.push(...buffer); // flush only on resolve; the throw above skips this line (rollback)
        return result as any;
      });

      await expect(service.reverseAndRebookIfChanged(seq0Input(60000))).rejects.toThrow();

      const forSource = txStore.filter((t) => t.sourceId === '900');
      expect(forSource).toHaveLength(1); // only the original seq0 survived — the reversal was rolled back
      expect(forSource[0].seq).toBe(0);
      expect(txStore.some((t) => t.reversalOfId != null)).toBe(false); // no orphan flat reversal persisted
    });

    it('is a no-op when nothing changed (idempotent re-scan) and when a sub-tolerance mark drift occurs', async () => {
      await service.bookTx(seq0Input(50000)); // seq0

      expect(await service.reverseAndRebookIfChanged(seq0Input(50000))).toBe(false); // identical → no-op
      // a priceChf drift below 1e-6 and amountChf below 0.005 must NOT trigger a reversal (§4.12 tolerances)
      const subTol = {
        ...seq0Input(50000),
        legs: [
          { account: walletAsset, amount: 1 + 5e-9, priceChf: 50000 + 5e-7, amountChf: 50000 + 0.002 },
          { account: liability, amount: -50000, priceChf: 1, amountChf: -50000 },
        ],
      };
      expect(await service.reverseAndRebookIfChanged(subTol)).toBe(false);
      expect(txStore.filter((t) => t.sourceId === '900')).toHaveLength(1); // still only seq0
    });

    it('returns false when no original booking exists at the seq (forward booker owns it)', async () => {
      expect(await service.reverseAndRebookIfChanged(seq0Input(50000))).toBe(false);
      expect(txStore).toHaveLength(0);
    });

    it('reverseActiveIfBooked reverses flat when the row is no longer bookable', async () => {
      await service.bookTx(seq0Input(50000)); // seq0

      const reversed = await service.reverseActiveIfBooked('bank_tx', '900', 0);
      expect(reversed).toBe(true);

      const all = txStore.filter((t) => t.sourceId === '900').sort((a, b) => a.seq - b.seq);
      expect(all.map((t) => t.seq)).toEqual([0, 1_000_000]); // forward seq0 + reversal in the correction range
      expect(all[1].reversalOfId).toBe(all[0].id); // flat reversal, no re-book
    });

    it('reverseActiveIfBooked is a no-op (false) when nothing is booked at the seq', async () => {
      expect(await service.reverseActiveIfBooked('bank_tx', '900', 0)).toBe(false);
      expect(txStore).toHaveLength(0);
    });

    // §4.12 activeTx walk: after a FIRST correction (seq0 reversed → re-book at 1_000_001), a SECOND content change
    // must reverse the LIVE re-book (NOT the original seq0) — the activeTx loop has to follow the chain twice.
    it('follows the reversal chain across TWO correction cycles (activeTx loop iterates, re-book of a re-book)', async () => {
      await service.bookTx(seq0Input(50000)); // seq0

      expect(await service.reverseAndRebookIfChanged(seq0Input(60000))).toBe(true); // cycle 1: re-book at 1_000_001
      expect(await service.reverseAndRebookIfChanged(seq0Input(70000))).toBe(true); // cycle 2: reverses the re-book

      const all = txStore.filter((t) => t.sourceId === '900').sort((a, b) => a.seq - b.seq);
      // forward seq0 + (reversal, re-book) ×2 → 5 tx, strictly monotone in the correction range
      expect(all.map((t) => t.seq)).toEqual([0, 1_000_000, 1_000_001, 1_000_002, 1_000_003]);
      // the cycle-2 reversal must target the cycle-1 re-book (seq 1_000_001), proving the walk advanced past seq0
      const rebook1 = all.find((t) => t.seq === 1_000_001);
      const reversal2 = all.find((t) => t.seq === 1_000_002);
      expect(reversal2.reversalOfId).toBe(rebook1.id);
      // the live re-book carries the latest value (70000)
      const live = all.find((t) => t.seq === 1_000_003);
      const liveLeg = live.legs.find((l) => l.account.id === walletAsset.id);
      expect(liveLeg.amountChf).toBe(70000);
    });

    // §4.12 activeTx: a flat reversal (reversed, NO re-book) makes the source "nothing booked now" → a later
    // reverseAndRebookIfChanged finds no active tx and is a no-op (returns false, walk returns undefined).
    it('treats a flat-reversed source as nothing-booked: a later reverse-and-rebook is a no-op', async () => {
      await service.bookTx(seq0Input(50000)); // seq0
      await service.reverseActiveIfBooked('bank_tx', '900', 0); // flat reversal, no re-book

      const changed = await service.reverseAndRebookIfChanged(seq0Input(99999));
      expect(changed).toBe(false); // activeTx walk hits the flat reversal → undefined → nothing to correct

      const all = txStore.filter((t) => t.sourceId === '900');
      expect(all).toHaveLength(2); // still only forward seq0 + the flat reversal, no new re-book
    });

    it('hasActiveTxAt is true for a live forward booking and false after a flat reversal', async () => {
      await service.bookTx(seq0Input(50000)); // seq0 live
      expect(await service.hasActiveTxAt('bank_tx', '900', 0)).toBe(true);

      await service.reverseActiveIfBooked('bank_tx', '900', 0); // flat reversal → nothing active at seq0
      expect(await service.hasActiveTxAt('bank_tx', '900', 0)).toBe(false);
    });

    it('hasActiveTxAt is false for a seq that was never booked', async () => {
      expect(await service.hasActiveTxAt('bank_tx', '900', 5)).toBe(false);
    });

    // §4.12 activeTx re-book selection (adjacency): the walk follows the corrected re-book at EXACTLY reversal.seq + 1
    // and ignores any higher, non-adjacent booking above the reversal. This seeds the adjacent re-book (1_000_001) plus
    // a higher decoy (1_000_002, inserted first, out of seq order) and asserts the walk resolves the chain to the
    // adjacent one (1_000_001), so a re-scan with the same value is a no-op.
    it('follows the adjacent re-book at reversal.seq + 1 and ignores a higher non-adjacent booking', async () => {
      await service.bookTx(seq0Input(50000)); // forward seq0 (id 1)
      const original = txStore.find((t) => t.seq === 0)!;

      // seed a reversal of seq0 plus the adjacent re-book (1_000_001) and a higher non-adjacent decoy (out of seq order)
      const reversal = Object.assign(new LedgerTx(), {
        id: nextId++,
        sourceType: 'bank_tx',
        sourceId: '900',
        seq: 1_000_000,
        reversalOfId: original.id,
        legs: [],
      });
      const rebookLater = Object.assign(new LedgerTx(), {
        id: nextId++,
        sourceType: 'bank_tx',
        sourceId: '900',
        seq: 1_000_002, // higher, non-adjacent (reversal.seq + 2) → the adjacency walk must ignore it
        legs: [
          { account: walletAsset, amount: 1, priceChf: 60000, amountChf: 60000 },
          { account: liability, amount: -60000, priceChf: 1, amountChf: -60000 },
        ],
      });
      const rebookEarliest = Object.assign(new LedgerTx(), {
        id: nextId++,
        sourceType: 'bank_tx',
        sourceId: '900',
        seq: 1_000_001, // adjacent (reversal.seq + 1) → the chain's next link
        legs: [
          { account: walletAsset, amount: 1, priceChf: 50000, amountChf: 50000 },
          { account: liability, amount: -50000, priceChf: 1, amountChf: -50000 },
        ],
      });
      txStore.push(reversal, rebookLater, rebookEarliest);

      // a re-scan with the SAME value as the adjacent re-book (50000) → the walk resolves the active tx to the
      // adjacent re-book (1_000_001), finds it unchanged → no-op (false). Resolving to the non-adjacent 1_000_002
      // (60000) instead would see a diff and wrongly book another reversal.
      const changed = await service.reverseAndRebookIfChanged(seq0Input(50000));
      expect(changed).toBe(false); // active tx = the 50000 re-book at 1_000_001 → unchanged → no reversal
      expect(txStore.filter((t) => t.sourceId === '900')).toHaveLength(4); // no new tx appended
    });

    // §4.12 activeTx adjacency (M2): a FLAT reversal (reversed, NO re-book) must resolve to "nothing booked", even
    // when an UNRELATED foreign correction (reversalOf NULL) sits at a HIGHER seq across a seq gap. The corrected
    // re-book is required at EXACTLY reversal.seq + 1; the OLD "smallest seq > reversal.seq" picker would grab the
    // foreign tx and wrongly report a phantom active booking (e.g. an ExchangeTrade fill flipped ok→failed).
    it('activeTx returns undefined for a flat reversal even when a foreign correction sits at a higher seq (adjacency)', async () => {
      await service.bookTx(seq0Input(50000)); // forward seq0 (id 1, reversalOf NULL)
      const original = txStore.find((t) => t.seq === 0)!;

      const reversal = Object.assign(new LedgerTx(), {
        id: nextId++,
        sourceType: 'bank_tx',
        sourceId: '900',
        seq: 1_000_000,
        reversalOfId: original.id, // flat reversal of seq0 — NO re-book at 1_000_001
        legs: [],
      });
      const foreign = Object.assign(new LedgerTx(), {
        id: nextId++,
        sourceType: 'bank_tx',
        sourceId: '900',
        seq: 1_000_005, // an unrelated correction (reversalOf NULL) across a seq gap — NOT the re-book of seq0
        reversalOfId: undefined,
        legs: [
          { account: walletAsset, amount: 1, priceChf: 99999, amountChf: 99999 },
          { account: liability, amount: -99999, priceChf: 1, amountChf: -99999 },
        ],
      });
      txStore.push(reversal, foreign);

      const active = await (service as any).activeTx('bank_tx', '900', 0);
      expect(active).toBeUndefined(); // flat reversal → nothing booked now; the foreign 1_000_005 tx must NOT be grabbed
    });

    // §4.12 needsMark reversal (line 103) + legsDiffer null tolerances (lines 206/207): a seq0 booked with a
    // needsMark ASSET leg (amountChf undefined). (a) re-scanning with the SAME needsMark legs → legsDiffer compares
    // null-vs-null via `within` (line 206 → true) → no-op. (b) re-scanning with the needsMark leg now VALUED → `within`
    // sees null-vs-number (line 207 → false) → reversal; the reversal inverts the needsMark leg → its amountChf stays
    // undefined (line 103 `: undefined` arm), proving the reversal preserves the unmarked state.
    // BOTH legs unmarked so the tx balances at 0 CHF cents (amountChf undefined == 0 cents) and bookTx accepts it,
    // while the legs carry needsMark=true / amountChf=undefined — the basis for the null-tolerance comparisons.
    const needsMarkInput = (marked: boolean) => ({
      sourceType: 'bank_tx',
      sourceId: '950',
      seq: 0,
      bookingDate: new Date('2026-06-01'),
      legs: marked
        ? [
            { account: walletAsset, amount: 1, priceChf: 50000, amountChf: 50000 },
            { account: liability, amount: -50000, priceChf: 1, amountChf: -50000 },
          ]
        : [
            { account: walletAsset, amount: 1, priceChf: null, amountChf: undefined, needsMark: true },
            { account: liability, amount: -1, priceChf: null, amountChf: undefined, needsMark: true },
          ],
    });

    it('no-ops when an unmarked seq0 is re-scanned unchanged (legsDiffer null-vs-null, line 206)', async () => {
      await service.bookTx(needsMarkInput(false)); // seq0 with TWO needsMark legs (both amountChf undefined, 0 cents)

      expect(await service.reverseAndRebookIfChanged(needsMarkInput(false))).toBe(false); // null vs null -> unchanged
      expect(txStore.filter((t) => t.sourceId === '950')).toHaveLength(1); // no reversal appended
    });

    it('reverses an unmarked seq0 when its legs become valued, keeping the reversed unmarked legs undefined (lines 103/207)', async () => {
      await service.bookTx(needsMarkInput(false)); // seq0 with TWO needsMark legs

      // the legs now carry CHF values -> legsDiffer within(null, 50000) is false (line 207) -> reversal + re-book
      expect(await service.reverseAndRebookIfChanged(needsMarkInput(true))).toBe(true);

      const all = txStore.filter((t) => t.sourceId === '950').sort((a, b) => a.seq - b.seq);
      expect(all.map((t) => t.seq)).toEqual([0, 1_000_000, 1_000_001]);
      // the reversal (seq 1_000_000) inverts the ORIGINAL (unmarked) legs; each original amountChf was undefined ->
      // its reversal leg is ALSO undefined (line 103 ": undefined" arm), NOT -0, and stays needsMark.
      const reversal = all.find((t) => t.seq === 1_000_000);
      for (const rl of reversal.legs) {
        expect(rl.amountChf == null).toBe(true); // value-less (line 103 ": undefined" arm) — NOT a number, NOT -0
        expect(typeof rl.amountChf).not.toBe('number'); // a -0 from a buggy `-leg.amountChf` would fail here
        expect(rl.needsMark).toBe(true);
      }
    });

    it('reverseAndRebookIfChanged returns true on a leg-COUNT change (different number of legs)', async () => {
      await service.bookTx(seq0Input(50000)); // 2-leg seq0

      // a 3-leg fresh input (extra EXPENSE leg) → legs.length differs → content changed regardless of tolerances
      const threeLeg = {
        sourceType: 'bank_tx',
        sourceId: '900',
        seq: 0,
        bookingDate: new Date('2026-06-01'),
        legs: [
          { account: walletAsset, amount: 1, priceChf: 50000, amountChf: 49990 },
          { account: liability, amount: -50000, priceChf: 1, amountChf: -50000 },
          { account: exchangeAsset, amount: 0, priceChf: 1, amountChf: 10 }, // extra leg
        ],
      };
      expect(await service.reverseAndRebookIfChanged(threeLeg)).toBe(true);
    });

    // --- §4.12 value-coupled chain reversal (M3) --- //

    // a value-coupled 2-seq chain on the SAME liability: seq0 opens the liability at −chf, seq1 closes it at +chf →
    // net 0. sum of `liability` amountChf across the whole store = the liability's running balance.
    const chainSeqs = (chf: number) => [
      {
        sourceType: 'bank_tx',
        sourceId: '960',
        seq: 0,
        bookingDate: new Date('2026-06-01'),
        legs: [
          { account: walletAsset, amount: 1, priceChf: chf, amountChf: chf },
          { account: liability, amount: -chf, priceChf: 1, amountChf: -chf }, // opens liability at −chf
        ],
      },
      {
        sourceType: 'bank_tx',
        sourceId: '960',
        seq: 1,
        bookingDate: new Date('2026-06-01'),
        legs: [
          { account: liability, amount: chf, priceChf: 1, amountChf: chf }, // closes liability at +chf
          { account: exchangeAsset, amount: -1, priceChf: chf, amountChf: -chf },
        ],
      },
    ];
    const liabilityBalance = () =>
      txStore
        .filter((t) => t.sourceId === '960')
        .flatMap((t) => t.legs)
        .filter((l) => l.account.id === liability.id)
        .reduce((s, l) => s + (l.amountChf ?? 0), 0);

    it('reverses the WHOLE value-coupled chain on a change so the shared liability still closes to 0 (M3)', async () => {
      const [seq0, seq1] = chainSeqs(50000);
      await service.bookTx(seq0);
      await service.bookTx(seq1);
      expect(liabilityBalance()).toBe(0); // opened −50000 (seq0), closed +50000 (seq1)

      // amountInChf changes 50000 → 60000: reversing ONLY seq0 would leave the liability at −10000 (the M3 bug). The
      // chain method reverses+rebooks BOTH active seqs → the liability closes cent-exact to 0 again.
      const changed = await service.reverseAndRebookChainIfChanged(chainSeqs(60000));
      expect(changed).toBe(true);
      expect(liabilityBalance()).toBe(0); // −50000 +50000(rev) −60000(rebook) +50000 −50000(rev) +60000(rebook) = 0

      // the live re-books carry the NEW value (60000) at both seqs
      const active0 = await (service as any).activeTx('bank_tx', '960', 0);
      const active1 = await (service as any).activeTx('bank_tx', '960', 1);
      expect(active0.legs.find((l: LedgerLeg) => l.account.id === liability.id).amountChf).toBe(-60000);
      expect(active1.legs.find((l: LedgerLeg) => l.account.id === liability.id).amountChf).toBe(60000);
    });

    it('reverseAndRebookChainIfChanged is a no-op (false) when nothing in the chain changed', async () => {
      const [seq0, seq1] = chainSeqs(50000);
      await service.bookTx(seq0);
      await service.bookTx(seq1);

      expect(await service.reverseAndRebookChainIfChanged(chainSeqs(50000))).toBe(false); // identical → no-op
      expect(txStore.filter((t) => t.sourceId === '960')).toHaveLength(2); // no reversal/re-book appended
    });

    it('reverseAndRebookChainIfChanged reverses ONLY the currently-active seqs (a not-yet-booked later seq is skipped)', async () => {
      const [seq0] = chainSeqs(50000);
      await service.bookTx(seq0); // only seq0 booked; seq1 not yet settled

      // seq0 changed, seq1 has no active booking → the chain reverses seq0 alone; seq1 is left to the forward path
      const changed = await service.reverseAndRebookChainIfChanged(chainSeqs(60000));
      expect(changed).toBe(true);
      const all = txStore.filter((t) => t.sourceId === '960').sort((a, b) => a.seq - b.seq);
      expect(all.map((t) => t.seq)).toEqual([0, 1_000_000, 1_000_001]); // seq0 reversal+rebook only, no seq1 tx
    });

    it('reverseAndRebookChainIfChanged returns false when no seq in the chain is booked yet', async () => {
      expect(await service.reverseAndRebookChainIfChanged(chainSeqs(50000))).toBe(false);
      expect(txStore.filter((t) => t.sourceId === '960')).toHaveLength(0);
    });

    it('hasAnyTxAt is true once a seq is booked (even after a flat reversal) and false for an unbooked seq', async () => {
      await service.bookTx(seq0Input(50000)); // seq0 booked
      expect(await service.hasAnyTxAt('bank_tx', '900', 0)).toBe(true);
      expect(await service.hasAnyTxAt('bank_tx', '900', 5)).toBe(false); // never booked at seq 5

      await service.reverseActiveIfBooked('bank_tx', '900', 0); // flat reversal — the original seq0 tx still EXISTS
      expect(await service.hasActiveTxAt('bank_tx', '900', 0)).toBe(false); // nothing ACTIVE
      expect(await service.hasAnyTxAt('bank_tx', '900', 0)).toBe(true); // but a tx still exists at seq0 (append-only)
    });
  });

  describe('rounding-account guard', () => {
    it('throws when the ROUNDING account is missing while a sub-cent rest needs plugging (CoA bootstrap missing)', async () => {
      jest.spyOn(ledgerAccountService, 'findByName').mockResolvedValue(undefined); // no ROUNDING account
      const legs: LedgerLegInput[] = [
        { account: walletAsset, amount: 1, priceChf: 50000.01, amountChf: 50000.01 }, // 1-cent rest needs ROUNDING
        { account: liability, amount: -50000, amountChf: -50000 },
      ];

      await expect(
        service.bookTx({
          sourceType: 'crypto_input',
          sourceId: '9',
          seq: 0,
          bookingDate: new Date('2026-06-01'),
          legs,
        }),
      ).rejects.toThrow(/ROUNDING/);
    });
  });
});
