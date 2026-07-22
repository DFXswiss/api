import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { CryptoInput, PayInStatus, PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountService } from '../../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { CryptoInputConsumer } from '../crypto-input.consumer';

const ZCHF_ASSET_ID = 200;
const BTC_ASSET_ID = 201;

function cryptoInput(values: Record<string, unknown>): CryptoInput {
  return Object.assign(new CryptoInput(), {
    id: 1,
    updated: new Date('2026-06-01T00:00:00Z'),
    status: PayInStatus.FORWARD_CONFIRMED,
    amount: 15000,
    asset: { id: ZCHF_ASSET_ID, uniqueName: 'Ethereum/ZCHF' },
    ...values,
  });
}

function account(name: string, type: AccountType, currency: string, assetId?: number): LedgerAccount {
  return createCustomLedgerAccount({ id: Math.floor(Math.random() * 1e6), name, type, currency, assetId } as any);
}

describe('CryptoInputConsumer', () => {
  let consumer: CryptoInputConsumer;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let markService: LedgerMarkService;
  let settingService: SettingService;
  let cryptoInputRepo: Repository<CryptoInput>;

  let booked: LedgerTxInput[];
  let accounts: Map<string, LedgerAccount>;
  let nextSeqValue: number;
  let activeKeys: Set<string>; // `${sourceId}:${seq}` with an active booking — backs hasActiveTxAt (per-seq, R3)

  const zchfWallet = account('Ethereum/ZCHF', AccountType.ASSET, 'ZCHF', ZCHF_ASSET_ID);
  const btcWallet = account('Bitcoin/BTC', AccountType.ASSET, 'BTC', BTC_ASSET_ID);

  // ZCHF mark ≈ 1; BTC mark = 50300 (so 1 BTC ≠ amountInChf 50000 → fx plug −300)
  const markMap = new Map([
    [ZCHF_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 1 }]],
    [BTC_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 50300 }]],
  ]);

  beforeEach(async () => {
    booked = [];
    nextSeqValue = 0;
    activeKeys = new Set<string>();
    accounts = new Map([
      ['Ethereum/ZCHF', zchfWallet],
      ['Bitcoin/BTC', btcWallet],
    ]);

    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    markService = createMock<LedgerMarkService>();
    settingService = createMock<SettingService>();
    cryptoInputRepo = createMock<Repository<CryptoInput>>();

    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      booked.push(input);
      activeKeys.add(`${input.sourceId}:${input.seq}`); // a freshly booked (sourceId,seq) is now active
      return Promise.resolve({} as any);
    });
    jest.spyOn(bookingService, 'nextSeq').mockImplementation(() => Promise.resolve(nextSeqValue));
    // alreadyBooked → hasActiveTxAt: true iff a booking exists AT this (sourceId, seq) (NOT nextSeq>seq, R3)
    jest
      .spyOn(bookingService, 'hasActiveTxAt')
      .mockImplementation((_st: string, sid: string, s: number) => Promise.resolve(activeKeys.has(`${sid}:${s}`)));

    jest
      .spyOn(accountService, 'findByAssetId')
      .mockImplementation((assetId: number) => Promise.resolve(assetId === BTC_ASSET_ID ? btcWallet : zchfWallet));
    jest
      .spyOn(accountService, 'findOrCreate')
      .mockImplementation((name: string, type: AccountType, currency: string) => {
        const existing = accounts.get(name);
        if (existing) return Promise.resolve(existing);
        const acc = account(name, type, currency);
        accounts.set(name, acc);
        return Promise.resolve(acc);
      });

    jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(markMap));
    jest.spyOn(markService, 'getLatestMark').mockResolvedValue(undefined); // B5: no bridge by default (tests opt in)
    jest.spyOn(settingService, 'getObj').mockResolvedValue(undefined);
    jest.spyOn(settingService, 'set').mockResolvedValue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestUtil.provideConfig(),
        CryptoInputConsumer,
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: LedgerMarkService, useValue: markService },
        { provide: SettingService, useValue: settingService },
        { provide: getRepositoryToken(CryptoInput), useValue: cryptoInputRepo },
      ],
    }).compile();

    consumer = module.get<CryptoInputConsumer>(CryptoInputConsumer);
  });

  const cents = (legs: LedgerLegInput[]) => legs.reduce((s, l) => s + Math.round((l.amountChf ?? 0) * 100), 0);
  // forward id-scan (where.id) returns the rows; the §4.12 content-change scan (where.updated MoreThan) returns []
  const mockBatch = (rows: CryptoInput[]) =>
    jest
      .spyOn(cryptoInputRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [] : rows));

  it('is defined', () => {
    expect(consumer).toBeDefined();
  });

  // §10.2 fixture (A) — stable ZCHF input: 3-leg with a near-zero fx plug
  it('books a stable ZCHF buyFiat input opening received at exactly −amountInChf', async () => {
    mockBatch([
      cryptoInput({
        id: 1,
        amount: 15000,
        asset: { id: ZCHF_ASSET_ID, uniqueName: 'Ethereum/ZCHF' },
        buyFiat: { amountInChf: 15000 } as any,
      }),
    ]);
    await consumer.process();

    const seq0 = booked.find((b) => b.seq === 0);
    const assetLeg = seq0.legs.find((l) => l.account.name === 'Ethereum/ZCHF');
    const received = seq0.legs.find((l) => l.account.name === 'LIABILITY/buyFiat-received');
    expect(assetLeg.amountChf).toBe(15000); // mark 1 × 15000
    expect(received.amountChf).toBe(-15000); // base anchor amountInChf
    expect(cents(seq0.legs)).toBe(0); // plug ≈ 0
  });

  // issue #4287 stage 1: the exact on-chain base units captured on the crypto_input flow onto the seq0 ASSET leg as an
  // explicit override, so the booking service persists them wei-exact (verified verbatim in the booking-service spec).
  it('passes the crypto_input amountBaseUnits onto the seq0 ASSET leg as an exact override', async () => {
    const exactWei = 123456789012345678n;
    mockBatch([
      cryptoInput({
        id: 7,
        amount: 0.12345679,
        amountBaseUnits: exactWei,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        buyFiat: { amountInChf: 50000 } as any,
      }),
    ]);
    await consumer.process();

    const seq0 = booked.find((b) => b.seq === 0);
    const assetLeg = seq0.legs.find((l) => l.account.name === 'Bitcoin/BTC');
    expect(assetLeg.amountBaseUnits).toBe(exactWei); // captured exact value forwarded, not re-derived from the float
  });

  // §10.2 fixture (B) — volatile BTC input: 3-leg with a real fx plug, received anchored at amountInChf
  it('books a volatile BTC buyFiat input as a 3-leg fx-plug tx, received = −amountInChf (Blocker R7-1)', async () => {
    mockBatch([
      cryptoInput({
        id: 2,
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        buyFiat: { amountInChf: 50000 } as any,
      }),
    ]);
    await consumer.process();

    const seq0 = booked.find((b) => b.seq === 0);
    expect(seq0.legs).toHaveLength(3);
    const assetLeg = seq0.legs.find((l) => l.account.name === 'Bitcoin/BTC');
    const received = seq0.legs.find((l) => l.account.name === 'LIABILITY/buyFiat-received');
    const plug = seq0.legs.find((l) => l.account.name?.includes('fx-revaluation'));
    expect(assetLeg.amountChf).toBe(50300); // mark × amount (NOT the pricing reference)
    expect(received.amountChf).toBe(-50000); // base anchor → seq1 clear closes received to 0
    // diff amountInChf − mark×amount = 50000 − 50300 = −300 < 0 → EXPENSE/fx-revaluation (§4.2a/§4.4a prose;
    // the §4.4a fixture annotation "→ Cr INCOME" contradicts both prose rules and is treated as the design typo)
    expect(plug.account.name).toBe('EXPENSE/fx-revaluation');
    expect(plug.amountChf).toBe(-300);
    expect(cents(seq0.legs)).toBe(0);
  });

  it('books a volatile buyCrypto-swap input against LIABILITY/buyCrypto-received', async () => {
    mockBatch([
      cryptoInput({
        id: 3,
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        buyCrypto: { amountInChf: 50000 } as any,
      }),
    ]);
    await consumer.process();
    const seq0 = booked.find((b) => b.seq === 0);
    expect(seq0.legs.some((l) => l.account.name === 'LIABILITY/buyCrypto-received')).toBe(true);
    expect(cents(seq0.legs)).toBe(0);
  });

  // §10.2 fixture (C) — paymentLink: 2-leg, mark-based, no fx plug (same mark both legs)
  it('books an isPayment input as a 2-leg mark-based tx against LIABILITY/paymentLink', async () => {
    mockBatch([
      cryptoInput({
        id: 4,
        amount: 1,
        txType: PayInType.PAYMENT,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
      }),
    ]);
    await consumer.process();

    const seq0 = booked.find((b) => b.seq === 0);
    expect(seq0.legs).toHaveLength(2);
    const paymentLink = seq0.legs.find((l) => l.account.name === 'LIABILITY/paymentLink');
    const assetLeg = seq0.legs.find((l) => l.account.name === 'Bitcoin/BTC');
    expect(assetLeg.amountChf).toBe(50300);
    expect(paymentLink.amountChf).toBe(-50300); // same mark both legs, no plug
    expect(cents(seq0.legs)).toBe(0);
  });

  // §10.2 fixture (B)(d) / Major B5 — no mark ANYWHERE (asset never fed): the mixed seq0 (needsMark crypto leg + −50000
  // received anchor) cannot balance and the bridge finds no mark → the row DEFERS (nothing booked, watermark unchanged),
  // NEVER an unbalanceable set handed to bookTx. A feedless asset is a genuine data state, retried next run.
  it('defers (no booking, watermark unchanged) when the ASSET leg has no mark anywhere (B5)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      cryptoInput({
        id: 5,
        amount: 1,
        asset: { id: 999, uniqueName: 'Unknown/XYZ' }, // no mark in markMap
        buyFiat: { amountInChf: 50000 } as any,
      }),
    ]);
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockResolvedValue(account('Unknown/XYZ', AccountType.ASSET, 'XYZ', 999));
    // markService.getLatestMark → undefined (auto-mock) → no bridge → resolveLegsOrDefer throws → failure-isolation
    await consumer.process();

    expect(booked.find((b) => b.seq === 0)).toBeUndefined(); // nothing booked (deferred)
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced → retry next run
  });

  // Major B5 bridge — a missing HISTORICAL mark but a present current mark: the crypto leg is valued with the youngest
  // available mark (bridge), needsMark STAYS true so the mark-to-market job corrects the basis later, and the seq0
  // balances via the real fx-revaluation spread (crypto value vs the amountInChf anchor) — no wedge.
  it('bridges a missing historical mark with the latest available mark and books balanced, needsMark stays true (B5)', async () => {
    jest.spyOn(markService, 'getLatestMark').mockResolvedValue(48000); // youngest available mark for asset 999
    mockBatch([
      cryptoInput({
        id: 5,
        amount: 1,
        asset: { id: 999, uniqueName: 'Unknown/XYZ' },
        buyFiat: { amountInChf: 50000 } as any,
      }),
    ]);
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockResolvedValue(account('Unknown/XYZ', AccountType.ASSET, 'XYZ', 999));

    await consumer.process();

    const seq0 = booked.find((b) => b.seq === 0);
    const assetLeg = seq0.legs.find((l) => l.account.name === 'Unknown/XYZ');
    expect(assetLeg.amountChf).toBe(48000); // bridged: 48000 × 1
    expect(assetLeg.needsMark).toBe(true); // stays true → mark-to-market re-marks to the real rate later
    // real fx-revaluation spread plug (+2000 = 50000 anchor − 48000 bridged), NOT a phantom full-value plug
    const fx = seq0.legs.find((l) => l.account.name?.includes('fx-revaluation'));
    expect(fx?.amountChf).toBe(2000);
    const cents = seq0.legs.reduce((s, l) => s + Math.round((l.amountChf ?? 0) * 100), 0);
    expect(cents).toBe(0); // balances
  });

  it('books the forward fee (seq1) only when outTxId + forwardFeeAmountChf are set', async () => {
    mockBatch([
      cryptoInput({
        id: 6,
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        buyFiat: { amountInChf: 50000 } as any,
        outTxId: '0xforward',
        forwardFeeAmount: 0.0001,
        forwardFeeAmountChf: 5,
      }),
    ]);
    await consumer.process();

    const seq1 = booked.find((b) => b.seq === 1);
    expect(seq1).toBeDefined();
    const networkFee = seq1.legs.find((l) => l.account.name === 'EXPENSE/network-fee');
    const wallet = seq1.legs.find((l) => l.account.name === 'Bitcoin/BTC');
    expect(networkFee.amountChf).toBe(5);
    expect(wallet.amountChf).toBe(-5);
    expect(cents(seq1.legs)).toBe(0);
  });

  it('does NOT book a forward fee leg when forwardFeeAmountChf is null (null strategy)', async () => {
    mockBatch([
      cryptoInput({
        id: 7,
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        buyFiat: { amountInChf: 50000 } as any,
        outTxId: '0xforward',
        forwardFeeAmountChf: null,
      }),
    ]);
    await consumer.process();
    expect(booked.some((b) => b.seq === 1)).toBe(false);
  });

  it('is idempotent: skips seq0 when an active booking already exists at seq0 (re-run)', async () => {
    activeKeys.add('8:0'); // seq0 of crypto_input 8 already active
    mockBatch([
      cryptoInput({
        id: 8,
        amount: 15000,
        asset: { id: ZCHF_ASSET_ID, uniqueName: 'Ethereum/ZCHF' },
        buyFiat: { amountInChf: 15000 } as any,
      }),
    ]);
    await consumer.process();
    expect(booked.some((b) => b.seq === 0)).toBe(false);
  });

  it('advances the watermark after a successful batch', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      cryptoInput({
        id: 9,
        amount: 15000,
        asset: { id: ZCHF_ASSET_ID, uniqueName: 'Ethereum/ZCHF' },
        buyFiat: { amountInChf: 15000 } as any,
      }),
    ]);
    await consumer.process();
    const written = JSON.parse(setSpy.mock.calls[0][1]);
    expect(written.lastProcessedId).toBe(9);
  });

  it('no-ops on an empty batch', async () => {
    mockBatch([]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  // --- ERROR / SKIP BRANCHES --- //

  // §4.4 skip: a crypto_input that is neither buyFiat/buyCrypto nor isPayment has no anchor → buildSeq0Input returns
  // undefined → no seq0 tx (the watermark still advances; it is a skip, not a failure)
  it('skips seq0 for a crypto_input with no buyFiat/buyCrypto anchor and not isPayment', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    const verboseSpy = jest.spyOn(DfxLogger.prototype, 'verbose').mockImplementation();
    const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
    mockBatch([
      cryptoInput({ id: 20, amount: 1, asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' } }), // no anchor
    ]);
    await consumer.process();

    expect(booked).toHaveLength(0); // no anchor → no seq0 tx at all
    expect(JSON.parse(setSpy.mock.calls[0][1]).lastProcessedId).toBe(20); // skip → watermark advances
    // the skip is expected/by-design state → logged at verbose, NOT error (no ERROR-dashboard spam every cycle)
    expect(verboseSpy).toHaveBeenCalledWith(expect.stringMatching(/has neither buyFiat\/buyCrypto nor isPayment/));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringMatching(/has neither buyFiat\/buyCrypto nor isPayment/));
    verboseSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // §4.4 walletAsset throw: a crypto_input with no asset throws → failure-isolation: watermark NOT advanced
  it('stops the batch and leaves the watermark when a crypto_input has no asset (failure-isolation)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([cryptoInput({ id: 21, amount: 1, asset: null, buyFiat: { amountInChf: 100 } as any })]);
    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled(); // throw → break before advancing
  });

  // §4.4 skip-guard: a NON-settled asset-less crypto_input (a FAILED pay-in) surfaced only by the content-change scan
  // is skipped (buildSeq0Input → undefined) instead of throwing "has no asset" every cycle → the cursor advances past
  // it (no more spam). A SETTLED asset-less row still fails loud (the failure-isolation test above).
  it('skips a non-settled asset-less crypto_input in the content-change scan (cursor advances, no throw)', async () => {
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    const failed = cryptoInput({ id: 40, amount: 1, asset: null, status: PayInStatus.CREATED }); // not settled
    // forward id-scan empty; content-change scan (where.updated) surfaces the asset-less non-settled row
    jest
      .spyOn(cryptoInputRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [failed] : []));

    await consumer.process();

    expect(rebookSpy).not.toHaveBeenCalled(); // buildSeq0Input returned undefined → no reverse/rebook
    expect(setSpy).toHaveBeenCalled(); // cursor advanced past the skipped row (it did NOT throw)
  });

  // §4.4 forward-fee idempotency: seq1 already active → bookForwardFee no-ops (only seq0 books)
  it('does NOT re-book the forward fee (seq1) when it is already active (re-run)', async () => {
    activeKeys.add('22:1'); // seq1 already booked
    mockBatch([
      cryptoInput({
        id: 22,
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        buyFiat: { amountInChf: 50000 } as any,
        outTxId: '0xforward',
        forwardFeeAmount: 0.0001,
        forwardFeeAmountChf: 5,
      }),
    ]);
    await consumer.process();

    expect(booked.some((b) => b.seq === 1)).toBe(false); // seq1 already active → skipped
    expect(booked.some((b) => b.seq === 0)).toBe(true); // seq0 still booked (not yet active)
  });

  // --- §4.12 CONTENT-CHANGE SCAN --- //

  // the content-change scan recomputes the seq0 input and calls reverseAndRebookIfChanged for a row past the cursor
  it('runs the §4.12 content-change scan: recomputes seq0 and calls reverseAndRebookIfChanged', async () => {
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    const changed = cryptoInput({
      id: 30,
      amount: 1,
      asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
      buyFiat: { amountInChf: 50000 } as any,
    });
    // forward id-scan empty; the content-change scan (where.updated) returns the changed row
    jest
      .spyOn(cryptoInputRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [changed] : []));

    await consumer.process();

    expect(rebookSpy).toHaveBeenCalledTimes(1);
    expect(rebookSpy.mock.calls[0][0].sourceId).toBe('30'); // recomputed seq0 input for the changed row
  });

  // §5.2 lookback: the content-change scan preloads marks over [daysBefore(2, ci.updated), ci.updated] — NOT a
  // zero-width [updated, updated] window — so getMarkAt finds the latest mark at-or-before the row timestamp for a
  // non-CHF asset (a zero-width window would leave the cache empty → CHF-unbalanced re-book → the cursor wedges).
  it('preloads the content-change marks over a daysBefore(2, ci.updated) lookback window', async () => {
    const preloadSpy = jest.spyOn(markService, 'preload');
    const updated = new Date('2026-05-15T09:00:00Z');
    const changed = cryptoInput({
      id: 31,
      updated,
      amount: 1,
      asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
      buyFiat: { amountInChf: 50000 } as any,
    });
    jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    jest
      .spyOn(cryptoInputRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [changed] : []));

    await consumer.process();

    // forward batch is empty → the only preload call is the content-change scan's
    const lastPreload = preloadSpy.mock.calls[preloadSpy.mock.calls.length - 1];
    expect(lastPreload[0]).toEqual(Util.daysBefore(2, updated));
    expect(lastPreload[1]).toEqual(updated);
  });

  // a content-change row with no anchor → buildSeq0Input undefined → reverseAndRebookIfChanged NOT called (no-op)
  it('content-change scan no-ops a row that has no bookable seq0 input', async () => {
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(false);
    const changed = cryptoInput({ id: 31, amount: 1, asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' } }); // no anchor
    jest
      .spyOn(cryptoInputRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [changed] : []));

    await consumer.process();

    expect(rebookSpy).not.toHaveBeenCalled(); // no seq0 input → nothing to reverse/rebook
  });

  // C1: a settled crypto_input surfaced ONLY by the content-change scan (the id-watermark advanced over it before it
  // reached a settled status) must be FORWARD-booked — book() runs from the scan callback under the settled-status gate.
  it('forward-books a late-settling crypto_input surfaced only by the content-change scan (C1)', async () => {
    const late = cryptoInput({
      id: 50,
      amount: 15000,
      asset: { id: ZCHF_ASSET_ID, uniqueName: 'Ethereum/ZCHF' },
      buyFiat: { amountInChf: 15000 } as any,
    });
    jest
      .spyOn(cryptoInputRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [late] : []));

    await consumer.process();

    const seq0 = booked.find((b) => b.seq === 0 && b.sourceId === '50');
    expect(seq0).toBeDefined(); // forward-booked by the content-change scan (the forward id-scan never returned it)
    expect(seq0.legs.find((l) => l.account.name === 'LIABILITY/buyFiat-received').amountChf).toBe(-15000);
  });

  // C1 gate: a NOT-yet-settled crypto_input in the content-change scan is NOT forward-booked (the settled-status gate
  // matches the forward filter) — its later settle bump on `updated` re-selects it.
  it('does NOT forward-book a not-yet-settled crypto_input in the content-change scan (settled-status gate)', async () => {
    const notSettled = cryptoInput({
      id: 51,
      status: PayInStatus.CREATED, // not in CryptoInputSettledStatus
      amount: 15000,
      asset: { id: ZCHF_ASSET_ID, uniqueName: 'Ethereum/ZCHF' },
      buyFiat: { amountInChf: 15000 } as any,
    });
    jest
      .spyOn(cryptoInputRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [notSettled] : []));

    await consumer.process();

    expect(booked.some((b) => b.sourceId === '51')).toBe(false); // not settled → not booked
  });

  // --- §6.3 COVERED-BY-CUTOVER-OPENING GUARD (C1) --- //

  // §6.3: a crypto_input already SETTLED at the cutover snapshot has its value in the aggregate ASSET opening. When its
  // `updated` is bumped post-cutover the content-change scan re-selects it, but its seq0 must NOT be re-booked — that
  // would double-count the ASSET + book a phantom liability. boundaryId 10, no holes → id 5 <= 10 and not a hole → covered.
  it('does NOT re-book a pre-cutover-settled crypto_input bumped post-cutover (covered by the aggregate opening)', async () => {
    const settled = cryptoInput({
      id: 5,
      amount: 15000,
      asset: { id: ZCHF_ASSET_ID, uniqueName: 'Ethereum/ZCHF' },
      buyFiat: { amountInChf: 15000 } as any,
    });
    jest
      .spyOn(settingService, 'getObj')
      .mockImplementation((key: string) =>
        Promise.resolve(key === 'ledgerCutoverBoundary.crypto_input' ? { boundaryId: 10, holeIds: [] } : undefined),
      );
    jest
      .spyOn(cryptoInputRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [settled] : []));

    await consumer.process();

    expect(booked.some((b) => b.sourceId === '5')).toBe(false); // covered → no fresh seq0 booking
  });

  // §6.3: an open-at-cutover crypto_input (value NOT in the aggregate opening) that settles post-cutover MUST book its
  // seq0 exactly once. Both the post-boundary path (id 12 > boundary 10) and the recorded-hole path (id 4 in holeIds)
  // book fresh — the guard suppresses only genuinely covered rows.
  it('books exactly one seq0 for an open-at-cutover crypto_input that settles post-cutover (hole + post-boundary)', async () => {
    const postBoundary = cryptoInput({
      id: 12,
      amount: 15000,
      asset: { id: ZCHF_ASSET_ID, uniqueName: 'Ethereum/ZCHF' },
      buyFiat: { amountInChf: 15000 } as any,
    });
    const hole = cryptoInput({
      id: 4,
      amount: 15000,
      asset: { id: ZCHF_ASSET_ID, uniqueName: 'Ethereum/ZCHF' },
      buyFiat: { amountInChf: 15000 } as any,
    });
    jest
      .spyOn(settingService, 'getObj')
      .mockImplementation((key: string) =>
        Promise.resolve(key === 'ledgerCutoverBoundary.crypto_input' ? { boundaryId: 10, holeIds: [4] } : undefined),
      );
    jest
      .spyOn(cryptoInputRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [hole, postBoundary] : []));

    await consumer.process();

    expect(booked.filter((b) => b.sourceId === '12' && b.seq === 0)).toHaveLength(1); // post-boundary → booked once
    expect(booked.filter((b) => b.sourceId === '4' && b.seq === 0)).toHaveLength(1); // recorded hole → booked once
  });

  // --- ADDITIONAL BRANCH COVERAGE --- //

  // line 117 UNDEFINED side: the resolved wallet LedgerAccount has assetId == null → the `wallet.assetId != null`
  // ternary takes the `: undefined` branch (NOT getMarkAt) → mark undefined → assetChf undefined → asset leg needsMark.
  // Major B5: a needsMark leg with NO assetId cannot be bridged (nothing to look up) → the mixed seq0 defers rather than
  // handing an unbalanceable set to bookTx. (Distinct from the id-5 test, which resolves a wallet WITH assetId.)
  it('defers when the wallet account has a null assetId (no mark, nothing to bridge — B5)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      cryptoInput({
        id: 40,
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        buyFiat: { amountInChf: 50000 } as any,
      }),
    ]);
    // wallet resolved WITHOUT an assetId → wallet.assetId == null → `: undefined` side of the line-117 ternary
    jest.spyOn(accountService, 'findByAssetId').mockResolvedValue(account('Bitcoin/BTC', AccountType.ASSET, 'BTC')); // no assetId

    await consumer.process();

    expect(booked.find((b) => b.seq === 0)).toBeUndefined(); // nothing booked (deferred — no assetId to bridge)
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced
  });

  // F5: an isPayment input on a feedless asset (no mark ANYWHERE) DEFERS. The paymentLink LIABILITY is CHF-denominated
  // (assetId=NULL) and the mark-to-market job (assetId IS NOT NULL) could NEVER revalue it, so booking it unvalued would
  // leave the merchant liability reading null forever downstream (§4.7b/F3 paymentLinkOpeningChf → permanent wedge).
  // A feedless asset is a genuine data state → fail-loud (nothing booked, watermark unchanged), retried next run.
  it('defers an isPayment input when the asset has no mark anywhere (F5)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      cryptoInput({
        id: 41,
        amount: 1,
        txType: PayInType.PAYMENT,
        asset: { id: 999, uniqueName: 'Unknown/XYZ' }, // no mark in markMap, getLatestMark → undefined
      }),
    ]);
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockResolvedValue(account('Unknown/XYZ', AccountType.ASSET, 'XYZ', 999));

    await consumer.process();

    expect(booked.find((b) => b.seq === 0)).toBeUndefined(); // deferred (feedless) — no unvalued paymentLink liability
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced → retry next run
  });

  // F5 bridge: an isPayment input with NO historical mark but a present current mark → the wallet leg is bridged with the
  // youngest available mark (needsMark STAYS true → the mark-to-market job re-marks the wallet ASSET later) and the
  // paymentLink LIABILITY is booked at exactly that bridged CHF value — never unvalued, so it reads a real value
  // downstream and the buy-fiat/buy-crypto paymentLink completion can clear it (§4.7b/F3).
  it('bridges an isPayment input with the latest mark and books the paymentLink liability valued (F5)', async () => {
    jest.spyOn(markService, 'getLatestMark').mockResolvedValue(48000); // youngest available mark for asset 999
    mockBatch([
      cryptoInput({
        id: 41,
        amount: 1,
        txType: PayInType.PAYMENT,
        asset: { id: 999, uniqueName: 'Unknown/XYZ' },
      }),
    ]);
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockResolvedValue(account('Unknown/XYZ', AccountType.ASSET, 'XYZ', 999));

    await consumer.process();

    const seq0 = booked.find((b) => b.seq === 0);
    expect(seq0.legs).toHaveLength(2);
    const assetLeg = seq0.legs.find((l) => l.account.name === 'Unknown/XYZ');
    const paymentLink = seq0.legs.find((l) => l.account.name === 'LIABILITY/paymentLink');
    expect(assetLeg.amountChf).toBe(48000); // bridged: 48000 × 1
    expect(assetLeg.needsMark).toBe(true); // stays true → mark-to-market re-marks the wallet ASSET to the real rate later
    expect(paymentLink.amountChf).toBe(-48000); // valued from the bridged wallet CHF (never null)
    expect(paymentLink.amount).toBe(-48000); // CHF-denominated: native == CHF value
    expect(paymentLink.needsMark).toBe(false); // booked with a value NOW; a CHF liability is never re-marked
    expect(cents(seq0.legs)).toBe(0); // same value both legs → balances, no plug
  });

  // B7 forward-fee: forwardFeeAmount (feeNative) null while forwardFeeAmountChf set → the native fee is DERIVED from
  // feeChf via the wallet mark (feeChf / mark), NEVER the CHF value booked as native units. BTC has a mark (50300) →
  // native = round(5 / 50300, 8), priceChf = 50300, amountChf = −5.
  it('derives the native forward fee from feeChf via the wallet mark when forwardFeeAmount is null (B7)', async () => {
    mockBatch([
      cryptoInput({
        id: 42,
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        buyFiat: { amountInChf: 50000 } as any,
        outTxId: '0xforward',
        forwardFeeAmount: null, // feeNative null → derive native from feeChf via the BTC mark (never CHF as native)
        forwardFeeAmountChf: 5,
      }),
    ]);
    await consumer.process();

    const seq1 = booked.find((b) => b.seq === 1);
    expect(seq1).toBeDefined();
    const networkFee = seq1.legs.find((l) => l.account.name === 'EXPENSE/network-fee');
    const wallet = seq1.legs.find((l) => l.account.name === 'Bitcoin/BTC');
    expect(networkFee.amountChf).toBe(5);
    expect(wallet.amount).toBe(-Util.round(5 / 50300, 8)); // native derived: feeChf / mark, NOT the CHF value
    expect(wallet.amountChf).toBe(-5);
    expect(wallet.priceChf).toBe(50300); // the wallet mark used to derive the native
    expect(cents(seq1.legs)).toBe(0);
  });

  // B7 fail-loud: forwardFeeAmount null AND no mark ANYWHERE for the wallet asset → refuse to book a CHF value as native
  // units; throw (failure-isolation, retry) instead. seq0 is pre-marked as already booked (activeKeys) so book() skips
  // it — otherwise F5 would defer the feedless isPayment seq0 first — isolating the forward-fee seq1 B7 guard.
  it('fails loud when the forward fee has no native amount and no mark to derive it (B7)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    activeKeys.add('43:0'); // seq0 already booked on a prior run → book() skips it, reaching the seq1 B7 guard directly
    mockBatch([
      cryptoInput({
        id: 43,
        amount: 1,
        txType: PayInType.PAYMENT,
        asset: { id: 999, uniqueName: 'Unknown/XYZ' }, // no mark in markMap, getLatestMark → undefined
        outTxId: '0xforward',
        forwardFeeAmount: null, // no native fee AND no mark → B7 throws rather than book CHF as native
        forwardFeeAmountChf: 5,
      }),
    ]);
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockResolvedValue(account('Unknown/XYZ', AccountType.ASSET, 'XYZ', 999));
    await consumer.process();

    expect(booked.find((b) => b.seq === 1)).toBeUndefined(); // forward fee NOT booked (fail-loud), never CHF as native
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced → retry
  });

  // lines 202/206 appendFxPlug POSITIVE residual: amountInChf > mark×amount → residual ≥ 0 → INCOME/fx-revaluation.
  // BTC mark 50300, amount 1, buyFiat.amountInChf 50600 → asset +50300, received −50600, sum −300 → residual +300.
  it('books an INCOME/fx-revaluation plug when the valuation residual is positive', async () => {
    mockBatch([
      cryptoInput({
        id: 43,
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        buyFiat: { amountInChf: 50600 } as any,
      }),
    ]);
    await consumer.process();

    const seq0 = booked.find((b) => b.seq === 0);
    expect(seq0.legs).toHaveLength(3);
    const assetLeg = seq0.legs.find((l) => l.account.name === 'Bitcoin/BTC');
    const received = seq0.legs.find((l) => l.account.name === 'LIABILITY/buyFiat-received');
    const plug = seq0.legs.find((l) => l.account.name?.includes('fx-revaluation'));
    expect(assetLeg.amountChf).toBe(50300);
    expect(received.amountChf).toBe(-50600);
    expect(plug.account.name).toBe('INCOME/fx-revaluation'); // residual +300 ≥ 0 → income side
    expect(plug.amountChf).toBe(300);
    expect(cents(seq0.legs)).toBe(0);
  });

  // line 227 walletAsset throw: an asset object IS present but findByAssetId returns undefined → throws (CoA bootstrap
  // missing) → failure-isolation: watermark NOT advanced, nothing booked. (Distinct from the id-21 'no asset' test,
  // which throws earlier at line 225.)
  it('stops the batch and leaves the watermark when the ledger account for the asset is missing (CoA bootstrap)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      cryptoInput({
        id: 44,
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        buyFiat: { amountInChf: 50000 } as any,
      }),
    ]);
    jest.spyOn(accountService, 'findByAssetId').mockResolvedValue(undefined); // account not found → throw at line 227

    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled(); // throw → break before advancing the watermark
  });
});
