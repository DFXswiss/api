import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import {
  PayoutOrder,
  PayoutOrderContext,
  PayoutOrderStatus,
} from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { Repository } from 'typeorm';
import { LedgerLeg } from '../../../entities/ledger-leg.entity';
import { LedgerTx } from '../../../entities/ledger-tx.entity';
import { AccountType, LedgerAccount } from '../../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountService } from '../../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { PayoutOrderConsumer } from '../payout-order.consumer';

const BTC_ASSET_ID = 301; // payout asset (volatile)
const ETH_ASSET_ID = 302; // distinct gas fee asset

function payoutOrder(values: Record<string, unknown>): PayoutOrder {
  return Object.assign(new PayoutOrder(), {
    id: 1,
    updated: new Date('2026-06-07T00:00:00Z'),
    status: PayoutOrderStatus.COMPLETE,
    context: PayoutOrderContext.BUY_CRYPTO,
    correlationId: '0',
    amount: 1,
    asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
    ...values,
  });
}

function account(name: string, type: AccountType, currency: string, assetId?: number): LedgerAccount {
  return createCustomLedgerAccount({ id: Math.floor(Math.random() * 1e6), name, type, currency, assetId } as any);
}

describe('PayoutOrderConsumer', () => {
  let consumer: PayoutOrderConsumer;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let markService: LedgerMarkService;
  let settingService: SettingService;
  let payoutOrderRepo: Repository<PayoutOrder>;
  let refRewardRepo: Repository<RefReward>;
  let buyCryptoRepo: Repository<BuyCrypto>;
  let buyFiatRepo: Repository<BuyFiat>;
  let ledgerTxRepo: Repository<LedgerTx>;

  let booked: LedgerTxInput[];
  let accounts: Map<string, LedgerAccount>;
  let nextSeqValue: number;

  const btcWallet = account('Bitcoin/BTC', AccountType.ASSET, 'BTC', BTC_ASSET_ID);
  const ethWallet = account('Ethereum/ETH', AccountType.ASSET, 'ETH', ETH_ASSET_ID);

  // BTC mark = 50000 (settlement); ETH mark = 2000
  const markMap = new Map([
    [BTC_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 50000 }]],
    [ETH_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 2000 }]],
  ]);

  beforeEach(async () => {
    booked = [];
    nextSeqValue = 0;
    accounts = new Map([
      ['Bitcoin/BTC', btcWallet],
      ['Ethereum/ETH', ethWallet],
    ]);

    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    markService = createMock<LedgerMarkService>();
    settingService = createMock<SettingService>();
    payoutOrderRepo = createMock<Repository<PayoutOrder>>();
    refRewardRepo = createMock<Repository<RefReward>>();
    buyCryptoRepo = createMock<Repository<BuyCrypto>>();
    buyFiatRepo = createMock<Repository<BuyFiat>>();
    ledgerTxRepo = createMock<Repository<LedgerTx>>();

    // by default no cutover opening exists → the owed-Dr falls back to the completion CHF (§4.5)
    jest.spyOn(ledgerTxRepo, 'findOne').mockResolvedValue(null);
    jest.spyOn(settingService, 'get').mockResolvedValue(undefined);

    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      booked.push(input);
      return Promise.resolve({} as any);
    });
    jest.spyOn(bookingService, 'nextSeq').mockImplementation(() => Promise.resolve(nextSeqValue));

    jest.spyOn(accountService, 'findByAssetId').mockImplementation((assetId: number) => {
      const wallet = assetId === ETH_ASSET_ID ? ethWallet : btcWallet;
      return Promise.resolve(wallet);
    });
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
    jest.spyOn(settingService, 'getObj').mockResolvedValue(undefined);
    jest.spyOn(settingService, 'set').mockResolvedValue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestUtil.provideConfig(),
        PayoutOrderConsumer,
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: LedgerMarkService, useValue: markService },
        { provide: SettingService, useValue: settingService },
        { provide: getRepositoryToken(PayoutOrder), useValue: payoutOrderRepo },
        { provide: getRepositoryToken(RefReward), useValue: refRewardRepo },
        { provide: getRepositoryToken(BuyCrypto), useValue: buyCryptoRepo },
        { provide: getRepositoryToken(BuyFiat), useValue: buyFiatRepo },
        { provide: getRepositoryToken(LedgerTx), useValue: ledgerTxRepo },
      ],
    }).compile();

    consumer = module.get<PayoutOrderConsumer>(PayoutOrderConsumer);
  });

  const cents = (legs: LedgerLegInput[]) => legs.reduce((s, l) => s + Math.round((l.amountChf ?? 0) * 100), 0);
  const mockBatch = (rows: PayoutOrder[]) => jest.spyOn(payoutOrderRepo, 'find').mockResolvedValue(rows);
  const leg = (tx: LedgerTxInput, name: string) => tx.legs.find((l) => l.account.name === name);

  it('is defined', () => {
    expect(consumer).toBeDefined();
  });

  // §4.5 BuyCrypto: Dr LIABILITY/buyCrypto-owed (completion CHF) / Cr ASSET/wallet (settlement mark) + fee +
  // fx-revaluation plug for the completion↔settlement drift (Blocker R2-2)
  it('books a BuyCrypto payout: owed = completion CHF, wallet = settlement mark, drift → fx plug', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 49500, totalFeeAmountChf: 100 } as any); // completion owed = 49400
    mockBatch([
      payoutOrder({
        id: 10,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '777',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        preparationFeeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' },
        preparationFeeAmount: 0.001,
        preparationFeeAmountChf: 2,
        payoutFeeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' },
        payoutFeeAmount: 0.0005,
        payoutFeeAmountChf: 1,
      }),
    ]);
    await consumer.process();

    const tx = booked[0];
    const owed = leg(tx, 'LIABILITY/buyCrypto-owed');
    const wallet = leg(tx, 'Bitcoin/BTC');
    const networkFee = leg(tx, 'EXPENSE/network-fee');
    const eth = leg(tx, 'Ethereum/ETH');
    expect(owed.amountChf).toBe(49400); // completion CHF (amountInChf − totalFeeAmountChf) → closes owed to 0
    expect(wallet.amountChf).toBe(-50000); // settlement mark × 1 BTC
    expect(networkFee.amountChf).toBe(3); // (2 + 1) additive, NOT the NaN-prone getter
    expect(eth.amountChf).toBe(-3); // native fee against ETH (0.0015 × 2000), not BTC (Major R7-1)
    expect(cents(tx.legs)).toBe(0); // fx plug closes 49400 − 50000 + 3 − 3 = −600 sum → +600 residual
    const plug = leg(tx, 'INCOME/fx-revaluation');
    expect(plug.amountChf).toBe(600); // residual = −(sum) = +600 ≥ 0 → INCOME/fx-revaluation
  });

  // §4.5 Major R6-1: a cutover-straddling owed-row debits the cutover OPENING CHF anchor (NOT the completion CHF),
  // so owed closes cent-exact to 0 and the opening↔settlement mark drift lands in the fx plug.
  it('books a cutover-straddling BuyCryptoReturn against the cutover opening CHF, not the completion CHF', async () => {
    // opening = 48000 (outputAmount × mark@snapshot); completion (if it were used) = 49400 → distinct on purpose
    const cutoverLogId = '1557344';
    jest.spyOn(settingService, 'get').mockResolvedValue(cutoverLogId);
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 49500, totalFeeAmountChf: 100 } as any);
    jest.spyOn(ledgerTxRepo, 'findOne').mockImplementation(({ where }: any) => {
      if (where?.sourceId === `${cutoverLogId}:buy_crypto-owed:790`) {
        const owedAccount = account('LIABILITY/buyCrypto-owed', AccountType.LIABILITY, 'CHF');
        const openingLeg = Object.assign(new LedgerLeg(), { account: owedAccount, amountChf: -48000 });
        return Promise.resolve(Object.assign(new LedgerTx(), { legs: [openingLeg] }));
      }
      return Promise.resolve(null);
    });
    mockBatch([
      payoutOrder({
        id: 20,
        context: PayoutOrderContext.BUY_CRYPTO_RETURN,
        correlationId: '790',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const tx = booked[0];
    const owed = leg(tx, 'LIABILITY/buyCrypto-owed');
    expect(owed.amountChf).toBe(48000); // the cutover opening CHF anchor (NOT the 49400 completion CHF)
    expect(leg(tx, 'Bitcoin/BTC').amountChf).toBe(-50000); // settlement mark × 1 BTC
    expect(cents(tx.legs)).toBe(0); // owed 48000 − 50000 = −2000 → +2000 fx plug closes the opening↔settlement drift
    expect(leg(tx, 'INCOME/fx-revaluation').amountChf).toBe(2000);
  });

  // §4.5 NaN-guard: only one fee field filled → additive ?? 0, not feeAmountChf getter (Major R2-5)
  it('uses additive (a ?? 0) + (b ?? 0) for the network fee, never the NaN-prone getter', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 11,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '778',
        amount: 1,
        preparationFeeAmountChf: null, // only payout fee filled → getter would yield NaN
        payoutFeeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' },
        payoutFeeAmount: 0.001,
        payoutFeeAmountChf: 2,
      }),
    ]);
    await consumer.process();

    const networkFee = leg(booked[0], 'EXPENSE/network-fee');
    expect(networkFee.amountChf).toBe(2); // 0 + 2, not NaN
    expect(cents(booked[0].legs)).toBe(0);
  });

  // §4.5 LN / no fee: networkFeeChf === 0 → no fee leg at all
  it('books no network-fee leg when both fee fields are null/zero (LN, D15 C.e)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 12,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '779',
        amount: 1,
        preparationFeeAmountChf: null,
        payoutFeeAmountChf: null,
      }),
    ]);
    await consumer.process();
    expect(leg(booked[0], 'EXPENSE/network-fee')).toBeUndefined();
  });

  // §4.5 RefPayout: Dr EXPENSE/refReward (= ref_reward.amountInChf via correlationId join) / Cr ASSET/wallet
  // deterministic (priceChf = amountInChf/amount), no plug on the main leg (Blocker R2-3)
  it('books a RefPayout against EXPENSE/refReward deterministically (no main-leg plug)', async () => {
    jest.spyOn(refRewardRepo, 'findOneBy').mockResolvedValue({ id: 55, amountInChf: 25 } as any);
    mockBatch([
      payoutOrder({
        id: 13,
        context: PayoutOrderContext.REF_PAYOUT,
        correlationId: '55',
        amount: 100, // 100 native units → priceChf = 0.25
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        payoutFeeAmountChf: 0, // RefPayout fee empirically sub-cent
        preparationFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const tx = booked[0];
    const refExpense = leg(tx, 'EXPENSE/refReward');
    const wallet = leg(tx, 'Bitcoin/BTC');
    expect(refExpense.amountChf).toBe(25); // = ref_reward.amountInChf
    expect(wallet.amountChf).toBe(-25); // cent-exact gegengleich → no fx plug
    expect(wallet.priceChf).toBeCloseTo(0.25, 8); // amountInChf/amount, derived display value (Minor R7-5)
    expect(leg(tx, 'EXPENSE/fx-revaluation')).toBeUndefined();
    expect(leg(tx, 'INCOME/fx-revaluation')).toBeUndefined();
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.5 RefPayout amount≈0 guard: priceChf = amountInChf/amount would be NaN/Infinity (Minor R6-6)
  it('guards RefPayout against amount≈0 (skips to avoid NaN priceChf)', async () => {
    jest.spyOn(refRewardRepo, 'findOneBy').mockResolvedValue({ id: 55, amountInChf: 25 } as any);
    mockBatch([payoutOrder({ id: 14, context: PayoutOrderContext.REF_PAYOUT, correlationId: '55', amount: 0 })]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  // §4.5 Major R7-1: native fee against a DISTINCT fee asset gets its own ASSET/{feeAsset} Cr leg
  it('books the native fee against the FEE asset, not the payout asset (Major R7-1)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 15,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '780',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        payoutFeeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' },
        payoutFeeAmount: 0.002,
        payoutFeeAmountChf: 4,
        preparationFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const tx = booked[0];
    expect(leg(tx, 'Ethereum/ETH').amount).toBe(-0.002); // native gegen ETH
    expect(leg(tx, 'Ethereum/ETH').amountChf).toBe(-4); // 0.002 × 2000
    expect(leg(tx, 'Bitcoin/BTC').amount).toBe(-1); // BTC leg only the payout amount, NOT amount + fee
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.5 fee-asset == payout-asset: folds into the same wallet Cr leg with a mixed effective priceChf (Minor R13-3)
  it('folds a payout-asset fee into the wallet Cr leg (feeAsset == payoutAsset)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 16,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '781',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        payoutFeeAsset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' }, // same as payout asset
        payoutFeeAmount: 0.0001,
        payoutFeeAmountChf: 5,
        preparationFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const tx = booked[0];
    const btcLegs = tx.legs.filter((l) => l.account.name === 'Bitcoin/BTC');
    expect(btcLegs).toHaveLength(1); // single combined leg (no separate ETH-style leg)
    expect(btcLegs[0].amount).toBe(-1.0001); // amount + fee folded native
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.5 missing wallet mark → needsMark, plug stays open, no silent priceChf=0
  it('flags the wallet leg needsMark when the payout-asset mark is missing', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockResolvedValue(account('Unknown/XYZ', AccountType.ASSET, 'XYZ', 999));
    mockBatch([
      payoutOrder({
        id: 17,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '782',
        amount: 1,
        asset: { id: 999, uniqueName: 'Unknown/XYZ' }, // no mark
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const wallet = leg(booked[0], 'Unknown/XYZ');
    expect(wallet.needsMark).toBe(true);
    expect(wallet.amountChf).toBeUndefined();
  });

  // §4.5 assetAccount throw (line 372): a distinct fee asset with no CoA ledger account → throws → failure-isolation
  // (watermark unchanged). The wallet (BTC) resolves fine; the ETH fee asset returns undefined → throw.
  it('stops the batch when a distinct fee asset has no ledger account (CoA bootstrap, line 372)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    jest.spyOn(accountService, 'findByAssetId').mockImplementation((assetId: number) => {
      if (assetId === ETH_ASSET_ID) return Promise.resolve(undefined); // fee asset not in the CoA → throw
      return Promise.resolve(btcWallet);
    });
    mockBatch([
      payoutOrder({
        id: 37,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '950',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        payoutFeeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' }, // distinct fee asset → its own leg → throws
        payoutFeeAmount: 0.001,
        payoutFeeAmountChf: 2,
        preparationFeeAmountChf: 0,
      }),
    ]);

    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('is idempotent: skips an already-booked payout (re-run, nextSeq > 0)', async () => {
    nextSeqValue = 1;
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([payoutOrder({ id: 18, context: PayoutOrderContext.BUY_CRYPTO, correlationId: '783', amount: 1 })]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  it('advances the watermark after a successful batch', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 19,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '784',
        amount: 1,
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();
    const written = JSON.parse(setSpy.mock.calls[0][1]);
    expect(written.lastProcessedId).toBe(19);
  });

  it('no-ops on an empty batch', async () => {
    mockBatch([]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  // --- ERROR / SKIP / FALLBACK BRANCHES --- //

  // §4.5 book guard: amount≈0 → skip (avoids NaN priceChf), watermark still advances past it (not an error)
  it('skips a payout with amount≈0 and still advances the watermark past it', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([payoutOrder({ id: 30, context: PayoutOrderContext.BUY_CRYPTO, correlationId: '800', amount: 0 })]);
    await consumer.process();

    expect(booked).toHaveLength(0); // amount≈0 → no tx
    expect(JSON.parse(setSpy.mock.calls[0][1]).lastProcessedId).toBe(30); // skip is not a failure → watermark advances
  });

  // §4.5 book guard: a payout_order with no asset throws → failure-isolation: watermark NOT advanced, retry next run
  it('stops the batch on a payout with no asset (failure-isolation, watermark unchanged)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([payoutOrder({ id: 31, context: PayoutOrderContext.BUY_CRYPTO, correlationId: '801', asset: null })]);
    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled(); // throw → break before advancing → watermark stays
  });

  // §4.5 failure-isolation: first row books, second throws (no asset) → watermark advances ONLY to the first
  it('advances the watermark to the last successful row and stops on the failing one', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 40,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '810',
        amount: 1,
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
      payoutOrder({ id: 41, context: PayoutOrderContext.BUY_CRYPTO, correlationId: '811', asset: null }), // throws
    ]);
    await consumer.process();

    expect(booked).toHaveLength(1); // only row 40 booked
    expect(JSON.parse(setSpy.mock.calls[0][1]).lastProcessedId).toBe(40); // NOT 41
  });

  // §4.5 RefPayout with no resolvable ref_reward.amountInChf → counter undefined → skip (no tx), watermark advances
  it('skips a RefPayout whose ref_reward has no amountInChf (counter undefined)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(refRewardRepo, 'findOneBy').mockResolvedValue(null); // no ref_reward found
    mockBatch([payoutOrder({ id: 32, context: PayoutOrderContext.REF_PAYOUT, correlationId: '802', amount: 10 })]);
    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(JSON.parse(setSpy.mock.calls[0][1]).lastProcessedId).toBe(32); // skip (not error) → advance
  });

  // §4.5 liabilityCounter defensive guard: an unmapped context value (bad DB data, not one of the 5 enum members and
  // not RefPayout) has no LIABILITY_BUCKET entry → liabilityCounter logs + returns undefined → the row is skipped.
  it('skips a payout with an unmapped context (defensive bucket guard)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      payoutOrder({ id: 33, context: 'UnknownContext' as PayoutOrderContext, correlationId: '803', amount: 1 }),
    ]);
    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(JSON.parse(setSpy.mock.calls[0][1]).lastProcessedId).toBe(33); // defensive skip → watermark still advances
  });

  // §4.5 owedCompletionChf: a non-integer correlationId (e.g. a network-start-fee marker) → mark fallback, NOT a
  // product lookup. The owed-Dr falls back to the settlement mark × amount.
  it('falls back to the settlement mark when the correlationId is non-integer (no product lookup)', async () => {
    const findSpy = jest.spyOn(buyCryptoRepo, 'findOneBy');
    mockBatch([
      payoutOrder({
        id: 34,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: 'network-start-fee', // non-integer → owedCompletionChf returns undefined → mark fallback
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const owed = leg(booked[0], 'LIABILITY/buyCrypto-owed');
    expect(findSpy).not.toHaveBeenCalled(); // non-integer correlationId never queries the product repo
    expect(owed.amountChf).toBe(50000); // settlement mark × 1 BTC (the completion fallback)
    expect(cents(booked[0].legs)).toBe(0);
  });

  // §4.5 BUY_FIAT_RETURN owed completion via the buyFiat repo (not buyCrypto), LIABILITY/buyFiat-owed bucket
  it('books a BuyFiatReturn against LIABILITY/buyFiat-owed using the buyFiat completion CHF', async () => {
    jest.spyOn(buyFiatRepo, 'findOneBy').mockResolvedValue({ amountInChf: 5000, totalFeeAmountChf: 50 } as any); // 4950
    mockBatch([
      payoutOrder({
        id: 35,
        context: PayoutOrderContext.BUY_FIAT_RETURN,
        correlationId: '900',
        amount: 0.1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const owed = leg(booked[0], 'LIABILITY/buyFiat-owed');
    expect(owed.amountChf).toBe(4950); // buyFiat amountInChf − totalFeeAmountChf
    expect(leg(booked[0], 'Bitcoin/BTC').amountChf).toBe(-5000); // settlement mark 50000 × 0.1
    expect(cents(booked[0].legs)).toBe(0);
  });

  // §4.5 withFxPlug needsMark short-circuit: when the wallet leg needsMark (no mark) the plug is NOT booked even
  // though the CHF cents don't balance — the mark-to-market job revalues it later (§5.1 Stufe 3, no silent plug).
  it('books NO fx-revaluation plug while the wallet leg needsMark (no silent plug, §5.1 Stufe 3)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockResolvedValue(account('Unknown/XYZ', AccountType.ASSET, 'XYZ', 999)); // no mark → needsMark
    mockBatch([
      payoutOrder({
        id: 36,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '901',
        amount: 1,
        asset: { id: 999, uniqueName: 'Unknown/XYZ' },
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    // owed-Dr 50000 (completion) + wallet needsMark (amountChf undefined) → cents don't net, but NO plug is appended
    expect(leg(booked[0], 'INCOME/fx-revaluation')).toBeUndefined();
    expect(leg(booked[0], 'EXPENSE/fx-revaluation')).toBeUndefined();
    expect(leg(booked[0], 'Unknown/XYZ').needsMark).toBe(true);
  });

  // §4.5 liabilityCounter (lines 220/223): a liability row where BOTH the completion CHF (non-integer correlationId →
  // no product lookup) AND the settlement CHF (no mark for the payout asset) are undefined → liabilityChf undefined →
  // the owed leg amount falls to 0, amountChf undefined, needsMark true. mainChf undefined → wallet also needsMark →
  // withFxPlug short-circuits, no plug.
  it('books an owed leg with amount 0 / needsMark when both completion and settlement CHF are undefined', async () => {
    const findSpy = jest.spyOn(buyCryptoRepo, 'findOneBy');
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockResolvedValue(account('Unknown/XYZ', AccountType.ASSET, 'XYZ', 999)); // no mark → settlementChf undefined
    mockBatch([
      payoutOrder({
        id: 50,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: 'no-product', // non-integer → no product completion AND no cutover opening match
        amount: 1,
        asset: { id: 999, uniqueName: 'Unknown/XYZ' }, // no mark
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const owed = leg(booked[0], 'LIABILITY/buyCrypto-owed');
    expect(findSpy).not.toHaveBeenCalled(); // non-integer correlationId → never queries the product repo
    expect(owed.amount).toBe(0); // liabilityChf undefined → amount falls to 0 (line 220)
    expect(owed.amountChf).toBeUndefined(); // line 222: amountChf = liabilityChf (undefined)
    expect(owed.needsMark).toBe(true); // line 223: needsMark = liabilityChf == null
    const wallet = leg(booked[0], 'Unknown/XYZ');
    expect(wallet.needsMark).toBe(true); // mainChf undefined → wallet leg needsMark too
    expect(wallet.amountChf).toBeUndefined();
    expect(leg(booked[0], 'INCOME/fx-revaluation')).toBeUndefined(); // a leg needsMark → no silent plug
    expect(leg(booked[0], 'EXPENSE/fx-revaluation')).toBeUndefined();
  });

  // §4.5 completionChf (line 246): a product whose amountInChf is null → completion undefined → mark fallback.
  it('falls back to the settlement mark when the product amountInChf is null (completion undefined)', async () => {
    const findSpy = jest
      .spyOn(buyCryptoRepo, 'findOneBy')
      .mockResolvedValue({ amountInChf: null, totalFeeAmountChf: 5 } as any); // amountInChf null → completion undefined
    mockBatch([
      payoutOrder({
        id: 51,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '850', // integer → product IS looked up
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const owed = leg(booked[0], 'LIABILITY/buyCrypto-owed');
    expect(findSpy).toHaveBeenCalled(); // integer correlationId → the product repo IS queried
    expect(owed.amountChf).toBe(50000); // completion undefined → settlement mark × 1 BTC fallback
    expect(leg(booked[0], 'Bitcoin/BTC').amountChf).toBe(-50000);
    expect(cents(booked[0].legs)).toBe(0);
  });

  // §4.5 completionChf (line 247): totalFeeAmountChf null → (totalFeeAmountChf ?? 0) takes the 0 side → completion =
  // amountInChf − 0.
  it('computes the completion CHF as amountInChf − 0 when totalFeeAmountChf is null', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 49000, totalFeeAmountChf: null } as any);
    mockBatch([
      payoutOrder({
        id: 52,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '851',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const owed = leg(booked[0], 'LIABILITY/buyCrypto-owed');
    expect(owed.amountChf).toBe(49000); // amountInChf − (null ?? 0)
    expect(leg(booked[0], 'Bitcoin/BTC').amountChf).toBe(-50000); // settlement mark
    expect(leg(booked[0], 'INCOME/fx-revaluation').amountChf).toBe(1000); // 49000 − 50000 = −1000 → +1000 INCOME plug
    expect(cents(booked[0].legs)).toBe(0);
  });

  // §4.5 cutoverOwedOpeningChf (line 256): MANUAL context has a LIABILITY_BUCKET (manual-debt) but NO CUTOVER_OWED_MARKER
  // entry → cutoverOwedOpeningChf returns undefined immediately; MANUAL also has no product completion (non-integer
  // correlationId) → the owed-Dr falls back to the settlement mark, booked against LIABILITY/manual-debt.
  it('books a MANUAL payout against LIABILITY/manual-debt at the settlement mark (no cutover owed marker)', async () => {
    const findSpy = jest.spyOn(buyCryptoRepo, 'findOneBy');
    jest.spyOn(settingService, 'get').mockResolvedValue('1234567'); // a cutover logId exists, but MANUAL has no marker
    mockBatch([
      payoutOrder({
        id: 53,
        context: PayoutOrderContext.MANUAL,
        correlationId: 'manual-ref', // non-integer → no product completion either
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const owed = leg(booked[0], 'LIABILITY/manual-debt');
    expect(owed).toBeDefined(); // booked against the MANUAL bucket
    expect(findSpy).not.toHaveBeenCalled(); // non-integer correlationId → no product lookup
    expect(owed.amountChf).toBe(50000); // settlement mark × 1 BTC (no cutover opening, no completion)
    expect(leg(booked[0], 'Bitcoin/BTC').amountChf).toBe(-50000);
    expect(cents(booked[0].legs)).toBe(0);
  });

  // §4.5 cutoverOwedOpeningChf (line 270): a cutover opening tx IS found but its owed leg amountChf is null →
  // cutoverOwedOpeningChf returns undefined → the owed-Dr falls back to the §4.6/§4.7 completion CHF (not the opening).
  it('falls back to the completion CHF when the matched cutover opening leg amountChf is null', async () => {
    const cutoverLogId = '999000';
    jest.spyOn(settingService, 'get').mockResolvedValue(cutoverLogId);
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 49000, totalFeeAmountChf: 0 } as any); // 49000
    jest.spyOn(ledgerTxRepo, 'findOne').mockImplementation(({ where }: any) => {
      if (where?.sourceId === `${cutoverLogId}:buy_crypto-owed:790`) {
        const owedAccount = account('LIABILITY/buyCrypto-owed', AccountType.LIABILITY, 'CHF');
        const openingLeg = Object.assign(new LedgerLeg(), { account: owedAccount, amountChf: null }); // null amountChf
        return Promise.resolve(Object.assign(new LedgerTx(), { legs: [openingLeg] }));
      }
      return Promise.resolve(null);
    });
    mockBatch([
      payoutOrder({
        id: 54,
        context: PayoutOrderContext.BUY_CRYPTO_RETURN,
        correlationId: '790',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const owed = leg(booked[0], 'LIABILITY/buyCrypto-owed');
    expect(owed.amountChf).toBe(49000); // opening leg amountChf null → undefined → completion CHF fallback
    expect(leg(booked[0], 'Bitcoin/BTC').amountChf).toBe(-50000); // settlement mark
    expect(leg(booked[0], 'INCOME/fx-revaluation').amountChf).toBe(1000); // 49000 − 50000 = −1000 → +1000 plug
    expect(cents(booked[0].legs)).toBe(0);
  });

  // §4.5 appendDistinctFeeLegs (lines 299-306): a DISTINCT fee asset (≠ payout asset) with NO mark → its native Cr
  // leg carries amountChf undefined + needsMark true + priceChf null; because a leg needsMark, withFxPlug books no plug.
  it('flags a distinct fee-asset leg needsMark when that fee asset has no mark (no plug booked)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    jest.spyOn(accountService, 'findByAssetId').mockImplementation((assetId: number) => {
      if (assetId === 888) return Promise.resolve(account('NoMark/NOM', AccountType.ASSET, 'NOM', 888));
      return Promise.resolve(btcWallet);
    });
    mockBatch([
      payoutOrder({
        id: 55,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '860',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' }, // payout asset has a mark
        payoutFeeAsset: { id: 888, uniqueName: 'NoMark/NOM' }, // distinct fee asset, NO mark
        payoutFeeAmount: 0.003,
        payoutFeeAmountChf: 5, // networkFeeChf 5 > 0 → fee legs are appended
        preparationFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const tx = booked[0];
    const feeLeg = leg(tx, 'NoMark/NOM');
    expect(feeLeg.amount).toBe(-0.003); // native fee against the fee asset
    expect(feeLeg.amountChf).toBeUndefined(); // no mark → chf undefined (line 304)
    expect(feeLeg.needsMark).toBe(true); // line 305: needsMark = chf == null
    expect(feeLeg.priceChf).toBeNull(); // line 303: priceChf = mark ?? null
    expect(leg(tx, 'EXPENSE/network-fee').amountChf).toBe(5); // CHF fee leg still booked
    expect(leg(tx, 'INCOME/fx-revaluation')).toBeUndefined(); // a leg needsMark → no plug
    expect(leg(tx, 'EXPENSE/fx-revaluation')).toBeUndefined();
  });

  // §4.5 payoutAssetFeeNative (line 318): a preparationFee in the payout asset itself folds into the wallet Cr leg
  // (native + mark-based CHF), distinct from the payoutFee fold (line 319) covered above.
  it('folds a payout-asset PREPARATION fee into the wallet Cr leg (preparationFeeAsset == payoutAsset)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 49000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 56,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '861',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        preparationFeeAsset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' }, // prep fee == payout asset → folds in
        preparationFeeAmount: 0.0002,
        preparationFeeAmountChf: 10,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const tx = booked[0];
    const btcLegs = tx.legs.filter((l) => l.account.name === 'Bitcoin/BTC');
    expect(btcLegs).toHaveLength(1); // prep fee folded into the single wallet leg, no separate fee-asset leg
    expect(btcLegs[0].amount).toBe(-1.0002); // amount + prep fee folded native (line 318)
    expect(btcLegs[0].amountChf).toBe(-50010); // settlement 50000 + folded fee 50000 × 0.0002 = 10
    expect(leg(tx, 'EXPENSE/network-fee').amountChf).toBe(10); // prep fee CHF still booked as the network-fee expense
    expect(leg(tx, 'INCOME/fx-revaluation').amountChf).toBe(1000); // 49000 − 50010 + 10 = −1000 → +1000 plug
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.5 payoutAssetFeeNative (line 325): the payout asset has NO mark → the folded payout-asset fee CHF takes the 0
  // side (mark != null ? ... : 0) and the fold flags needsMark; mainChf undefined → wallet leg needsMark → no plug.
  it('takes chf=0 for a folded payout-asset fee when the payout asset has no mark (needsMark)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 49000, totalFeeAmountChf: 0 } as any);
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockResolvedValue(account('Unknown/XYZ', AccountType.ASSET, 'XYZ', 999)); // no mark
    mockBatch([
      payoutOrder({
        id: 57,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '862',
        amount: 1,
        asset: { id: 999, uniqueName: 'Unknown/XYZ' }, // no mark
        preparationFeeAsset: { id: 999, uniqueName: 'Unknown/XYZ' }, // fee in the (unmarked) payout asset → folds in
        preparationFeeAmount: 0.0002,
        preparationFeeAmountChf: 0, // networkFeeChf 0 → no separate fee leg
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const tx = booked[0];
    const walletLegs = tx.legs.filter((l) => l.account.name === 'Unknown/XYZ');
    expect(walletLegs).toHaveLength(1); // fee folded into the single wallet leg
    expect(walletLegs[0].amount).toBe(-1.0002); // amount + folded fee native
    expect(walletLegs[0].amountChf).toBeUndefined(); // no mark → mainChf undefined → wallet chf undefined
    expect(walletLegs[0].needsMark).toBe(true); // fee.needsMark (no mark) → wallet needsMark
    expect(leg(tx, 'INCOME/fx-revaluation')).toBeUndefined(); // a leg needsMark → no plug
    expect(leg(tx, 'EXPENSE/fx-revaluation')).toBeUndefined();
  });

  // §4.5 withFxPlug (lines 351/355): a constellation with Σ legs > 0 → residual < 0 → EXPENSE/fx-revaluation (the
  // negative residual side, complementing the INCOME side hit by the BuyCrypto payout test). completion > settlement.
  it('books an EXPENSE/fx-revaluation plug when the residual is negative (completion > settlement)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 51000, totalFeeAmountChf: 0 } as any); // 51000
    mockBatch([
      payoutOrder({
        id: 58,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '863',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const tx = booked[0];
    expect(leg(tx, 'LIABILITY/buyCrypto-owed').amountChf).toBe(51000); // completion CHF
    expect(leg(tx, 'Bitcoin/BTC').amountChf).toBe(-50000); // settlement mark
    const plug = leg(tx, 'EXPENSE/fx-revaluation');
    expect(plug.amountChf).toBe(-1000); // Σ = 51000 − 50000 = +1000 → residual −1000 → EXPENSE/fx-revaluation
    expect(leg(tx, 'INCOME/fx-revaluation')).toBeUndefined();
    expect(cents(tx.legs)).toBe(0);
  });
});
