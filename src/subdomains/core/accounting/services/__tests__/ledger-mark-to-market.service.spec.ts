import { createMock } from '@golevelup/ts-jest';
import { CronExpression } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Process } from 'src/shared/services/process.service';
import { DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { TestUtil } from 'src/shared/utils/test.util';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountRepository } from '../../repositories/ledger-account.repository';
import { LedgerLegRepository } from '../../repositories/ledger-leg.repository';
import { LedgerBookingJobService } from '../ledger-booking-job.service';
import { LedgerBookingService, LedgerTxInput } from '../ledger-booking.service';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { LedgerMarkToMarketService } from '../ledger-mark-to-market.service';

interface LegQueryStub {
  candidateIds?: number[]; // selectCandidates getRawMany — single page (returned regardless of the lastId watermark)
  candidatePages?: Record<number, number[]>; // selectCandidates getRawMany — paged by lastId watermark (overrides candidateIds)
  balance?: { native: string; chf: string }; // accountBalance getRawOne
  alreadyBookedCount?: number; // alreadyBooked getCount
}

describe('LedgerMarkToMarketService', () => {
  let service: LedgerMarkToMarketService;

  let jobService: LedgerBookingJobService;
  let settingService: SettingService;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let markService: LedgerMarkService;
  let ledgerAccountRepository: LedgerAccountRepository;
  let ledgerLegRepository: LedgerLegRepository;

  let booked: LedgerTxInput[];
  let legStub: LegQueryStub;

  const fxIncome = createCustomLedgerAccount({ id: 80, name: 'INCOME/fx-revaluation', type: AccountType.INCOME });
  const fxExpense = createCustomLedgerAccount({ id: 81, name: 'EXPENSE/fx-revaluation', type: AccountType.EXPENSE });

  function markedAccount(assetId: number): LedgerAccount {
    return createCustomLedgerAccount({
      id: 1000 + assetId,
      name: `Asset/${assetId}`,
      type: AccountType.ASSET,
      assetId,
    });
  }

  // a chainable query-builder stub that resolves its terminal method from legStub by query shape. selectCandidates'
  // `.andWhere('leg.accountId > :lastId', { lastId })` is captured per builder instance so getRawMany can serve a
  // different page per id-watermark (candidatePages) — the basis for the multi-page pagination test.
  function legQb(): any {
    const qb: any = {};
    let lastId = 0; // the id-watermark this builder was filtered on (selectCandidates page)
    const chain = () => qb;
    qb.innerJoin = chain;
    qb.select = chain;
    qb.addSelect = chain;
    qb.where = chain;
    qb.andWhere = (_clause: string, params?: { lastId?: number }) => {
      if (params && typeof params.lastId === 'number') lastId = params.lastId;
      return qb;
    };
    qb.groupBy = chain;
    qb.having = chain;
    qb.orderBy = chain;
    qb.limit = chain;
    qb.getRawMany = () => {
      const ids = legStub.candidatePages ? (legStub.candidatePages[lastId] ?? []) : (legStub.candidateIds ?? []);
      return Promise.resolve(ids.map((id) => ({ accountId: id })));
    };
    qb.getRawOne = () => Promise.resolve(legStub.balance ?? { native: '0', chf: '0' });
    qb.getCount = () => Promise.resolve(legStub.alreadyBookedCount ?? 0);
    return qb;
  }

  beforeEach(async () => {
    booked = [];
    legStub = {};

    jobService = createMock<LedgerBookingJobService>();
    settingService = createMock<SettingService>();
    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    markService = createMock<LedgerMarkService>();
    ledgerAccountRepository = createMock<LedgerAccountRepository>();
    ledgerLegRepository = createMock<LedgerLegRepository>();

    jest.spyOn(jobService, 'isLedgerReady').mockResolvedValue(true);
    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      booked.push(input);
      return Promise.resolve({} as any);
    });
    jest.spyOn(accountService, 'findOrCreate').mockImplementation((name: string) => {
      return Promise.resolve(name === 'INCOME/fx-revaluation' ? fxIncome : fxExpense);
    });
    jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() => legQb());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerMarkToMarketService,
        TestUtil.provideConfig(),
        { provide: LedgerBookingJobService, useValue: jobService },
        { provide: SettingService, useValue: settingService },
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: LedgerMarkService, useValue: markService },
        { provide: LedgerAccountRepository, useValue: ledgerAccountRepository },
        { provide: LedgerLegRepository, useValue: ledgerLegRepository },
      ],
    }).compile();

    service = module.get<LedgerMarkToMarketService>(LedgerMarkToMarketService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('runs off-peak at 04:00 with its own LEDGER_MARK_TO_MARKET kill-switch (Hard Constraint #5, §5.3)', () => {
    const params: DfxCronParams = Reflect.getMetadata(DFX_CRONJOB_PARAMS, LedgerMarkToMarketService.prototype.run);
    expect(params.expression).toBe(CronExpression.EVERY_DAY_AT_4AM);
    expect(params.process).toBe(Process.LEDGER_MARK_TO_MARKET);
  });

  it('no-ops while the ledger is not ready (cutover-gate)', async () => {
    jest.spyOn(jobService, 'isLedgerReady').mockResolvedValue(false);

    await service.run();

    expect(bookingService.bookTx).not.toHaveBeenCalled();
  });

  it('books a positive revaluation Dr ASSET / Cr INCOME/fx-revaluation when the mark rises', async () => {
    legStub = { candidateIds: [205], balance: { native: '100', chf: '90' }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    // mark 1.0 → newChf = 100; oldChf = 90; diff +10
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    expect(booked).toHaveLength(1);
    const tx = booked[0];
    expect(tx.sourceType).toBe('mark_to_market');
    expect(tx.sourceId).toBe('1005');

    const assetLeg = tx.legs.find((l) => l.account.type === AccountType.ASSET);
    expect(assetLeg.amount).toBe(0); // native unchanged, CHF re-valuation only (§5.3)
    expect(assetLeg.amountChf).toBe(10);

    const fxLeg = tx.legs.find((l) => l.account.name === 'INCOME/fx-revaluation');
    expect(fxLeg.amountChf).toBe(-10); // Σ CHF = 0
  });

  it('books a negative revaluation against EXPENSE/fx-revaluation when the mark falls', async () => {
    legStub = { candidateIds: [205], balance: { native: '100', chf: '120' }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    const fxLeg = booked[0].legs.find((l) => l.account.type === AccountType.EXPENSE);
    expect(fxLeg.account.name).toBe('EXPENSE/fx-revaluation');
    expect(booked[0].legs.find((l) => l.account.type === AccountType.ASSET).amountChf).toBe(-20);
  });

  it('does not book when the account is still feedless (no mark → no phantom revaluation)', async () => {
    legStub = { candidateIds: [205], balance: { native: '100', chf: '0' }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map())); // no mark for asset 5

    await service.run();

    expect(bookingService.bookTx).not.toHaveBeenCalled();
  });

  // line 147: a candidate whose native balance is ≈0 (closed) is skipped — nothing to revalue.
  it('does not revalue a closed account (native balance ≈ 0)', async () => {
    legStub = { candidateIds: [205], balance: { native: '0', chf: '5' }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    expect(bookingService.bookTx).not.toHaveBeenCalled(); // |nativeBalance| ≤ 1e-8 → closed → no revaluation
  });

  // lines 183-184: accountBalance treats a NULL getRawOne (no legs) as native 0 / chf 0 (the `?? 0` fallbacks). An
  // account whose balance query returns {native:null, chf:null} → nativeBalance 0 → closed → no booking.
  it('treats a null balance query result as native 0 / chf 0 (no revaluation)', async () => {
    legStub = { candidateIds: [205], balance: { native: null as any, chf: null as any }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    expect(bookingService.bookTx).not.toHaveBeenCalled(); // null → 0 → closed
  });

  // line 88: a full first page (= batchSize) followed by an EMPTY second page → the loop fetches page 2, sees no ids,
  // and breaks via `if (!page.ids.length) break` (the explicit empty-page exit, distinct from the partial-page exit).
  it('exits cleanly when the page AFTER a full first page is empty (empty-page break, line 88)', async () => {
    const batchSize = Config.ledger.backfillBatchSize;
    const page1Ids = Array.from({ length: batchSize }, (_, i) => 101 + i);
    const page1MaxId = page1Ids[page1Ids.length - 1];

    legStub = {
      candidatePages: { 0: page1Ids, [page1MaxId]: [] }, // page 1 full, page 2 empty
      balance: { native: '100', chf: '90' },
      alreadyBookedCount: 0,
    };
    const accountById = new Map<number, LedgerAccount>(
      page1Ids.map((id) => [
        id,
        createCustomLedgerAccount({ id, name: `Asset/${id}`, type: AccountType.ASSET, assetId: 5 }),
      ]),
    );
    jest
      .spyOn(ledgerAccountRepository, 'findBy')
      .mockImplementation((where: any) =>
        Promise.resolve((where.id.value as number[]).map((id) => accountById.get(id))),
      );
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    expect(booked).toHaveLength(page1Ids.length); // exactly page-1 accounts revalued; page-2 empty → clean exit
  });

  it('does not book when the CHF difference is sub-cent', async () => {
    legStub = { candidateIds: [205], balance: { native: '100', chf: '100' }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    expect(bookingService.bookTx).not.toHaveBeenCalled();
  });

  it('is idempotent within the same day (already-booked day → no-op)', async () => {
    legStub = { candidateIds: [205], balance: { native: '100', chf: '90' }, alreadyBookedCount: 1 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([markedAccount(5)]);
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    expect(bookingService.bookTx).not.toHaveBeenCalled();
  });

  it('no-ops when no open accounts qualify', async () => {
    legStub = { candidateIds: [] };

    await service.run();

    expect(markService.preload).not.toHaveBeenCalled();
    expect(bookingService.bookTx).not.toHaveBeenCalled();
  });

  // run() failure-isolation (line 57): markToMarket throwing (e.g. the candidate query fails) is caught and logged,
  // run() resolves without rethrowing — the cron must never crash the scheduler.
  it('catches a markToMarket error in run() and never rethrows (failure-isolation)', async () => {
    legStub = { candidateIds: [205], balance: { native: '100', chf: '90' }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() => {
      throw new Error('db down'); // the very first selectCandidates query throws
    });
    const errSpy = jest.spyOn(service['logger'], 'error');

    await expect(service.run()).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith('Ledger mark-to-market failed', expect.any(Error));
    expect(bookingService.bookTx).not.toHaveBeenCalled();
  });

  // per-account failure-isolation (line 81): one account's revaluation throwing must NOT abort the others — the loop
  // catches, logs, and continues to the next account, which still books its revaluation.
  it('isolates a single failing account: the others are still revalued (catch in the revalue loop)', async () => {
    legStub = { candidateIds: [205, 206], balance: { native: '100', chf: '90' }, alreadyBookedCount: 0 };
    const good = markedAccount(5); // assetId 5 has a mark → revalues fine
    const bad = createCustomLedgerAccount({ id: 9000, name: 'Asset/bad', type: AccountType.ASSET, assetId: 6 });
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([bad, good]); // bad processed first
    // bookTx throws for the bad account (id 9000 → sourceId '9000'), succeeds for the good one
    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      if (input.sourceId === '9000') return Promise.reject(new Error('boom'));
      booked.push(input);
      return Promise.resolve({} as any);
    });
    jest.spyOn(markService, 'preload').mockResolvedValue(
      new LedgerMarkCache(
        new Map([
          [5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]],
          [6, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]],
        ]),
      ),
    );
    const errSpy = jest.spyOn(service['logger'], 'error');

    await service.run();

    expect(errSpy).toHaveBeenCalledWith('Failed to mark-to-market ledger account 9000', expect.any(Error));
    expect(booked.map((t) => t.sourceId)).toEqual(['1005']); // the good account still booked despite the bad one
  });

  // §4.2-Note B-19 / Point 4: a CHF-denominated LIABILITY bucket (assetId=NULL) carries no native FX exposure → it is
  // CHF-stable and MUST NOT be revalued (a balance with no asset cannot be re-marked; there is no wandering drift to
  // correct). Even if such an account were returned as a candidate, revalue() must early-return at assetId==null.
  it('never revalues a CHF-denominated LIABILITY (assetId=NULL) — no phantom drift on a CHF-stable balance', async () => {
    const chfLiability = createCustomLedgerAccount({
      id: 9001,
      name: 'LIABILITY/unattributed',
      type: AccountType.LIABILITY,
      assetId: null,
    } as any);
    legStub = { candidateIds: [9001], balance: { native: '950', chf: '900' }, alreadyBookedCount: 0 };
    jest.spyOn(ledgerAccountRepository, 'findBy').mockResolvedValue([chfLiability]);
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    expect(bookingService.bookTx).not.toHaveBeenCalled(); // assetId=NULL → no re-mark, no phantom revaluation
  });

  // §5.3 (Major, analog reconciliation §7.0): the candidate universe is paginated by id-watermark, NOT truncated at
  // a single `.limit(batchSize)`. This drives selectCandidates over two pages: page 1 (lastId 0) fills a whole
  // batchSize window → the loop must fetch page 2 (lastId = page-1 maxId); page 2 is smaller → exhausted. Accounts on
  // BOTH pages must be revalued (a single-page truncation would silently never re-mark page 2 → permanently stale CHF).
  it('paginates the candidate universe and revalues accounts beyond the first batchSize page', async () => {
    const batchSize = Config.ledger.backfillBatchSize; // 100 (test default)

    // page 1 fills the whole window (ids 101..100+batchSize), page 2 (lastId = page-1 maxId) is a single trailing id
    const page1Ids = Array.from({ length: batchSize }, (_, i) => 101 + i);
    const page1MaxId = page1Ids[page1Ids.length - 1];
    const page2Ids = [page1MaxId + 1];

    legStub = {
      candidatePages: { 0: page1Ids, [page1MaxId]: page2Ids },
      balance: { native: '100', chf: '90' }, // newChf = 100 (mark 1.0 × 100), oldChf = 90 → diff +10 → books
      alreadyBookedCount: 0,
    };

    // every candidate shares assetId 5 (one mark in the cache) but a distinct account id → distinct revaluation-tx
    const accountById = new Map<number, LedgerAccount>(
      [...page1Ids, ...page2Ids].map((id) => [
        id,
        createCustomLedgerAccount({ id, name: `Asset/${id}`, type: AccountType.ASSET, assetId: 5 }),
      ]),
    );
    const selectCandidates = jest.spyOn(service as any, 'selectCandidates');
    jest
      .spyOn(ledgerAccountRepository, 'findBy')
      .mockImplementation((where: any) =>
        Promise.resolve((where.id.value as number[]).map((id) => accountById.get(id))),
      );
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[5, [{ created: new Date('2026-06-01'), priceChf: 1.0 }]]])));

    await service.run();

    // selectCandidates is called twice: page 1 (full window) → loop fetches page 2 (smaller → exhausted)
    expect(selectCandidates).toHaveBeenCalledTimes(2);
    expect(selectCandidates).toHaveBeenNthCalledWith(1, 0, batchSize);
    expect(selectCandidates).toHaveBeenNthCalledWith(2, page1MaxId, batchSize);

    // every account on BOTH pages is revalued (one tx per account) — none beyond the first page is silently dropped
    expect(booked).toHaveLength(page1Ids.length + page2Ids.length);
    const bookedSourceIds = booked.map((tx) => tx.sourceId);
    expect(bookedSourceIds).toContain(`${page1Ids[0]}`); // first id of page 1
    expect(bookedSourceIds).toContain(`${page1MaxId}`); // last id of page 1 (the watermark)
    expect(bookedSourceIds).toContain(`${page2Ids[0]}`); // the page-2 account beyond the first batchSize window
  });
});
