import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
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

  beforeEach(async () => {
    savedLegs = [];

    dataSource = createMock<DataSource>();
    ledgerAccountService = createMock<LedgerAccountService>();

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
      return runInTransaction(manager) as any;
    });

    jest.spyOn(ledgerAccountService, 'findByName').mockResolvedValue(roundingAccount);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestUtil.provideConfig(),
        LedgerBookingService,
        { provide: DataSource, useValue: dataSource },
        { provide: LedgerAccountService, useValue: ledgerAccountService },
      ],
    }).compile();

    service = module.get<LedgerBookingService>(LedgerBookingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
    expect(typeof tx.amountChfSum).toBe('number'); // integer type guarantee (Blocker R1-4)
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

  it('does NOT apply a native balance check on value-boundary tx (asset ↔ liability)', async () => {
    const logSpy = jest.spyOn((service as any).logger, 'error');
    const legs: LedgerLegInput[] = [
      { account: walletAsset, amount: 1, priceChf: 50000, amountChf: 50000 }, // BTC one-sided, correct
      { account: liability, amount: -50000, amountChf: -50000 },
    ];

    await service.bookTx({
      sourceType: 'crypto_input',
      sourceId: '4',
      seq: 0,
      bookingDate: new Date('2026-06-01'),
      legs,
    });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs a native imbalance only for pure same-asset transfers', async () => {
    const logSpy = jest.spyOn((service as any).logger, 'error');
    const legs: LedgerLegInput[] = [
      { account: exchangeAsset, amount: 1, priceChf: 50000, amountChf: 50000 },
      { account: walletAsset, amount: -1, priceChf: 50000, amountChf: -50000 }, // same BTC ccy, balanced native
    ];

    await service.bookTx({
      sourceType: 'exchange_tx',
      sourceId: '5',
      seq: 0,
      bookingDate: new Date('2026-06-01'),
      legs,
    });

    expect(logSpy).not.toHaveBeenCalled(); // native nets to 0 → no error

    logSpy.mockClear();
    const unbalanced: LedgerLegInput[] = [
      { account: exchangeAsset, amount: 1, priceChf: 50000, amountChf: 50000 },
      { account: walletAsset, amount: -2, priceChf: 25000, amountChf: -50000 }, // native BTC ≠ 0
    ];

    await service.bookTx({
      sourceType: 'exchange_tx',
      sourceId: '6',
      seq: 0,
      bookingDate: new Date('2026-06-01'),
      legs: unbalanced,
    });

    expect(logSpy).toHaveBeenCalled(); // pure same-asset transfer with native imbalance → logged
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
        return (arg as (m: EntityManager) => unknown)(manager) as any;
      });

      jest.spyOn(dataSource, 'getRepository').mockReturnValue({
        find: ({ where }: any) =>
          Promise.resolve(
            txStore
              .filter((tx) => tx.sourceType === where.sourceType && tx.sourceId === where.sourceId)
              .sort((a, b) => a.seq - b.seq),
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

    // §4.12 activeTx re-book selection (line 192): when MORE THAN ONE non-reversal booking sits above the reversal's
    // seq, the walk must pick the one with the SMALLEST seq via `.sort((a,b) => a.seq - b.seq)[0]`. A single candidate
    // never invokes the comparator; this seeds two candidates (1_000_001 and 1_000_002) above the reversal so the
    // comparator actually runs and the EARLIEST corrected re-book (1_000_001) is chosen as the chain's next link.
    it('picks the smallest-seq re-book when several non-reversal tx sit above the reversal (sort comparator)', async () => {
      await service.bookTx(seq0Input(50000)); // forward seq0 (id 1)
      const original = txStore.find((t) => t.seq === 0)!;

      // seed a reversal of seq0 plus TWO independent non-reversal re-books above it (out of seq order on purpose)
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
        seq: 1_000_002, // larger seq, inserted first → comparator must still pick the smaller one
        legs: [
          { account: walletAsset, amount: 1, priceChf: 60000, amountChf: 60000 },
          { account: liability, amount: -60000, priceChf: 1, amountChf: -60000 },
        ],
      });
      const rebookEarliest = Object.assign(new LedgerTx(), {
        id: nextId++,
        sourceType: 'bank_tx',
        sourceId: '900',
        seq: 1_000_001, // the SMALLEST seq above the reversal → the chain's next link
        legs: [
          { account: walletAsset, amount: 1, priceChf: 50000, amountChf: 50000 },
          { account: liability, amount: -50000, priceChf: 1, amountChf: -50000 },
        ],
      });
      txStore.push(reversal, rebookLater, rebookEarliest);

      // a re-scan with the SAME value as the earliest re-book (50000) → the walk resolves the active tx to the
      // smallest-seq re-book (1_000_001), finds it unchanged → no-op (false). A broken comparator would resolve to
      // 1_000_002 (60000), see a diff, and wrongly book another reversal.
      const changed = await service.reverseAndRebookIfChanged(seq0Input(50000));
      expect(changed).toBe(false); // active tx = the 50000 re-book at 1_000_001 → unchanged → no reversal
      expect(txStore.filter((t) => t.sourceId === '900')).toHaveLength(4); // no new tx appended
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
