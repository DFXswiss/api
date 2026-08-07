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
    jest.spyOn(markService, 'getLatestMark').mockResolvedValue(undefined); // B5: no bridge by default (tests opt in)
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
  // forward id-scan returns the rows; the §4.12 content-change scan (where has `updated`, not `id`) returns [] so the
  // forward path is asserted in isolation (its late-settling coverage has dedicated two-run tests below).
  const mockBatch = (rows: PayoutOrder[]) =>
    jest
      .spyOn(payoutOrderRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [] : rows));
  const leg = (tx: LedgerTxInput, name: string) => tx.legs.find((l) => l.account.name === name);

  it('is defined', () => {
    expect(consumer).toBeDefined();
  });

  // issue #4287 stage 1: the exact on-chain send base units captured at broadcast are booked VERBATIM on the withdrawal
  // wallet (Cr) leg — negated to match the credit — when no payout-asset fee is folded into that leg.
  it('books the captured exact base units verbatim on the wallet leg (no payout-asset fee folded in)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 20,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '778',
        amount: 1,
        amountBaseUnits: 100000000n, // exact base units captured at broadcast
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        // fee in a DISTINCT asset (ETH) → nothing folded into the BTC wallet leg
        payoutFeeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' },
        payoutFeeAmount: 0.0005,
        payoutFeeAmountChf: 1,
      }),
    ]);
    await consumer.process();

    const wallet = leg(booked[0], 'Bitcoin/BTC');
    expect(wallet.amount).toBe(-1); // native credit, no fee folded
    expect(wallet.amountBaseUnits).toBe(-100000000n); // captured value booked verbatim, negated for the Cr leg
  });

  // issue #4287 stage 1 (fail-open): once a payout-asset fee is folded into the wallet leg its native quantity is
  // amount + fee, which no longer matches the captured order.amountBaseUnits → the override is suppressed and the
  // ledger derives from the float as before.
  it('suppresses the exact override on the wallet leg when a payout-asset fee is folded in', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 21,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '779',
        amount: 1,
        amountBaseUnits: 100000000n,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        // fee in the SAME asset (BTC) → folded into the wallet leg, so its native quantity is amount + fee
        payoutFeeAsset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        payoutFeeAmount: 0.0005,
        payoutFeeAmountChf: 1,
      }),
    ]);
    await consumer.process();

    const wallet = leg(booked[0], 'Bitcoin/BTC');
    expect(wallet.amount).toBeCloseTo(-1.0005, 8); // order.amount + folded payout-asset fee
    expect(wallet.amountBaseUnits).toBeUndefined(); // override suppressed → booking service derives from the float
  });

  // issue #4287 stage 3: the exact on-chain gas-fee wei captured at completion is booked VERBATIM on the DISTINCT
  // network-fee leg (negated to match the credit) when no preparation fee in the SAME asset is aggregated into it.
  it('books the captured exact gas-fee wei verbatim on the distinct network-fee leg (#4287 stage 3)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 30,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '800',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' }, // payout asset = BTC
        payoutFeeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' }, // gas in a DISTINCT asset (ETH)
        payoutFeeAmount: 0.00042,
        payoutFeeAmountChf: 0.84, // 0.00042 x mark 2000
        payoutFeeAmountBaseUnits: 420000000000000n, // exact wei captured from the receipt
      }),
    ]);
    await consumer.process();

    const eth = leg(booked[0], 'Ethereum/ETH');
    expect(eth.amount).toBeCloseTo(-0.00042, 8); // Cr native fee leg
    expect(eth.amountBaseUnits).toBe(-420000000000000n); // captured wei booked verbatim, negated for the Cr leg
  });

  // issue #4287 stage 3 (fail-open): a preparation fee in the SAME asset is aggregated into the fee leg, so its native
  // quantity (prep + payout) no longer matches the captured payout-fee wei → the override is suppressed (derive).
  it('suppresses the exact override when a same-asset preparation fee is aggregated in (#4287 stage 3)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 31,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '801',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        preparationFeeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' }, // SAME asset as the payout fee
        preparationFeeAmount: 0.0001,
        preparationFeeAmountChf: 0.2,
        payoutFeeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' },
        payoutFeeAmount: 0.00042,
        payoutFeeAmountChf: 0.84,
        payoutFeeAmountBaseUnits: 420000000000000n,
      }),
    ]);
    await consumer.process();

    const eth = leg(booked[0], 'Ethereum/ETH');
    expect(eth.amount).toBeCloseTo(-0.00052, 8); // prep + payout aggregated → diverges from the captured wei
    expect(eth.amountBaseUnits).toBeUndefined(); // override suppressed → booking service derives from the float
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
    expect(leg(tx, 'Ethereum/ETH').amount).toBe(-0.002); // native against ETH
    expect(leg(tx, 'Ethereum/ETH').amountChf).toBe(-4); // 0.002 × 2000
    expect(leg(tx, 'Bitcoin/BTC').amount).toBe(-1); // BTC leg only the payout amount, NOT amount + fee
    expect(cents(tx.legs)).toBe(0);
  });

  // #4277: the per-distinct-asset native leg must survive even when the persisted CHF sum rounds to 0 (sub-cent gas) —
  // the early-return gate is removed and only the CHF EXPENSE leg is gated on feeChf.
  it('#4277: books a distinct fee-asset native leg even when the persisted CHF sum is 0 (sub-cent gas)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    mockBatch([
      payoutOrder({
        id: 30,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '800',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        payoutFeeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' },
        payoutFeeAmount: 0.000001, // 0.000001 × 2000 = 0.002 CHF → rounds to 0.00
        payoutFeeAmountChf: 0,
        preparationFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const tx = booked[0];
    expect(leg(tx, 'Ethereum/ETH').amount).toBe(-0.000001); // native gas outflow survives (the fix)
    expect(leg(tx, 'Ethereum/ETH').amountChf === 0).toBe(true); // sub-cent → 0 CHF, leg not omitted
    expect(leg(tx, 'EXPENSE/network-fee')).toBeUndefined(); // a 0-CHF EXPENSE leg is suppressed
    expect(cents(tx.legs)).toBe(0);
  });

  // #4277 conservatism: at feeChf 0, an unvaluable distinct fee asset (no mark / no account) falls back to today's
  // skip — no new deferral, the payout still books.
  it('#4277: at feeChf 0, skips the native leg for an unvaluable distinct fee asset (no new deferral)', async () => {
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockImplementation((id: number) =>
        Promise.resolve(id === ETH_ASSET_ID ? ethWallet : id === BTC_ASSET_ID ? btcWallet : undefined),
      );
    mockBatch([
      payoutOrder({
        id: 31,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: '801',
        amount: 1,
        asset: { id: BTC_ASSET_ID, uniqueName: 'Bitcoin/BTC' },
        payoutFeeAsset: { id: 888, uniqueName: 'Feedless/XYZ' }, // no mark, no account
        payoutFeeAmount: 0.5,
        payoutFeeAmountChf: 0,
        preparationFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    expect(booked).toHaveLength(1); // booked, not deferred/thrown
    expect(booked[0].legs.find((l) => l.account.name === 'Feedless/XYZ')).toBeUndefined(); // native leg skipped
    expect(leg(booked[0], 'EXPENSE/network-fee')).toBeUndefined();
    expect(cents(booked[0].legs)).toBe(0);
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
  // Major B5 — no mark ANYWHERE for the payout (wallet) asset: the mixed tx (unvalued wallet + valued owed completion CHF)
  // cannot balance and the bridge finds no mark → the row DEFERS (nothing booked, watermark unchanged).
  it('defers when the payout-asset mark is missing everywhere (mixed tx cannot balance, B5)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
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

    expect(booked[0]).toBeUndefined(); // nothing booked (deferred)
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced
  });

  // Major B5 bridge — a missing HISTORICAL payout-asset mark but a present current mark: the wallet leg is valued with
  // the youngest available mark (bridge), needsMark STAYS true so the mark-to-market job corrects the basis later, and
  // the tx balances via the fx-revaluation plug (bridged wallet value vs the owed completion CHF).
  it('bridges a missing historical payout-asset mark and books balanced, needsMark stays true (B5)', async () => {
    jest.spyOn(markService, 'getLatestMark').mockResolvedValue(49000); // youngest available mark for asset 999
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
        asset: { id: 999, uniqueName: 'Unknown/XYZ' },
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const wallet = leg(booked[0], 'Unknown/XYZ');
    expect(wallet.amountChf).toBe(-49000); // bridged Cr wallet: −(49000 × 1)
    expect(wallet.needsMark).toBe(true); // stays true → mark-to-market re-marks later
    const cents = booked[0].legs.reduce((s, l) => s + Math.round((l.amountChf ?? 0) * 100), 0);
    expect(cents).toBe(0); // balances (owed +50000, wallet −49000, fx-revaluation plug −1000)
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

  // --- C1: LATE-SETTLING FORWARD COVERAGE (content-change scan) --- //

  // C1: a payout that is NOT yet Complete when the forward id-watermark advances OVER it (a later, higher-id row does
  // settle) would be forward-unreachable once it completes. The status-agnostic content-change scan must forward-book
  // it on the run after it settles — the row is NOT lost. Two runs: run 1 advances the watermark past the unsettled
  // id; the row completes; run 2's forward id-scan no longer returns it, but the content-change scan does and books it.
  it('forward-books a payout that settled AFTER the id-watermark advanced over it (C1, two runs)', async () => {
    // realistic idempotency: a sourceId already booked reports nextSeq > 0, so re-selecting an already-booked row in
    // the content-change scan is a no-op (does not double-book)
    jest
      .spyOn(bookingService, 'nextSeq')
      .mockImplementation((_st, sourceId: string) =>
        Promise.resolve(booked.some((t) => t.sourceId === sourceId) ? 1 : 0),
      );
    jest.spyOn(buyCryptoRepo, 'findOneBy').mockResolvedValue({ amountInChf: 50000, totalFeeAmountChf: 0 } as any);

    const settled = payoutOrder({
      id: 61,
      correlationId: '901',
      amount: 1,
      preparationFeeAmountChf: 0,
      payoutFeeAmountChf: 0,
    });
    const lateBefore = payoutOrder({
      id: 60,
      correlationId: '900',
      amount: 1,
      status: PayoutOrderStatus.CREATED,
      preparationFeeAmountChf: 0,
      payoutFeeAmountChf: 0,
    });
    const lateAfter = payoutOrder({
      id: 60,
      correlationId: '900',
      amount: 1,
      status: PayoutOrderStatus.COMPLETE,
      preparationFeeAmountChf: 0,
      payoutFeeAmountChf: 0,
    });

    // RUN 1: forward returns only the Complete row 61 (id-watermark jumps to 61, over the still-Created id 60); the
    // content-change scan sees both, skips row 60 (not yet Complete) and no-ops row 61 (already booked).
    jest
      .spyOn(payoutOrderRepo, 'find')
      .mockImplementation(({ where }: any) =>
        Promise.resolve(where?.updated != null ? [lateBefore, settled] : [settled]),
      );
    await consumer.process();
    expect(booked.map((b) => b.sourceId)).toEqual(['61']); // row 60 not booked (still Created)

    // RUN 2: row 60 has since completed. The forward id-scan (id > 61) no longer returns it — forward-unreachable.
    // The content-change scan re-selects it (updated bump) and books it because it now satisfies the settled filter.
    jest
      .spyOn(payoutOrderRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [lateAfter] : []));
    await consumer.process();
    expect(booked.map((b) => b.sourceId).sort()).toEqual(['60', '61']); // row 60 finally booked on the second run
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
  // though the CHF cents don't balance — the mark-to-market job revalues it later (§5.1 stage 3, no silent plug).
  // Major B5 — never hand an unbalanceable set to bookTx: a needsMark wallet leg with no bridge on a mixed tx defers
  // (owed-Dr 50000 completion + unvalued wallet → cannot net) rather than booking a silent phantom plug.
  it('defers a mixed tx with a needsMark wallet leg and no bridge (no silent plug, B5)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
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

    expect(booked[0]).toBeUndefined(); // deferred: no booking, no silent phantom plug
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced
  });

  // §4.5 F6 fail-loud: a liability row where BOTH the completion CHF (non-integer correlationId → no product lookup) AND
  // the settlement CHF (no historical mark for the payout asset) are undefined would book an unvalued needsMark leg on
  // the assetId-less LIABILITY (CHF-denominated → the mark-to-market job can NEVER revalue it). When the youngest-mark
  // bridge ALSO finds nothing (truly feedless), the consumer FAILS LOUD WITH an alarm (nothing booked, watermark
  // unchanged) rather than a never-revaluable phantom leg that, mixed with a bridged wallet leg, would wedge every run.
  it('fails loud (alarm) when the owed leg has no completion, no settlement, and a feedless payout asset (F6)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    const errorSpy = jest.spyOn((consumer as any).logger, 'error');
    const findSpy = jest.spyOn(buyCryptoRepo, 'findOneBy');
    // no mark anywhere: getMarkAt undefined (asset 999 not in markMap) AND getLatestMark undefined (default) → no bridge
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockResolvedValue(account('Unknown/XYZ', AccountType.ASSET, 'XYZ', 999));
    mockBatch([
      payoutOrder({
        id: 50,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: 'no-product', // non-integer → no product completion AND no cutover opening match
        amount: 1,
        asset: { id: 999, uniqueName: 'Unknown/XYZ' }, // feedless
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    expect(findSpy).not.toHaveBeenCalled(); // non-integer correlationId → never queries the product repo
    expect(booked).toHaveLength(0); // deferred: nothing booked (no unvalued LIABILITY leg on an assetId-less account)
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced → retry next run
    expect(errorSpy.mock.calls.some((c) => /feedless/i.test(String(c[0])))).toBe(true); // F6 alarm logged
  });

  // §4.5 F6 bridge: no completion AND no historical settlement mark BUT a youngest mark exists → the settlement (and
  // thus BOTH the owed LIABILITY leg and the wallet leg) is bridged from that mark so the tx balances now; the wallet
  // ASSET leg keeps needsMark → the mark-to-market job corrects its basis later. No wedge, no unvalued liability leg.
  it('bridges the owed leg from the latest mark when completion and historical settlement are missing (F6)', async () => {
    jest.spyOn(markService, 'getLatestMark').mockResolvedValue(49000); // youngest available mark for asset 999
    jest
      .spyOn(accountService, 'findByAssetId')
      .mockResolvedValue(account('Unknown/XYZ', AccountType.ASSET, 'XYZ', 999));
    mockBatch([
      payoutOrder({
        id: 50,
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: 'no-product', // non-integer → no product completion AND no cutover opening
        amount: 1,
        asset: { id: 999, uniqueName: 'Unknown/XYZ' }, // no historical mark, but getLatestMark bridges it
        preparationFeeAmountChf: 0,
        payoutFeeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const owed = leg(booked[0], 'LIABILITY/buyCrypto-owed');
    const wallet = leg(booked[0], 'Unknown/XYZ');
    expect(owed.amountChf).toBe(49000); // bridged settlement (no completion anchor) → owed leg valued
    expect(owed.needsMark).toBe(false); // CHF-denominated liability: valued now, never a mark-to-market candidate
    expect(wallet.amountChf).toBe(-49000); // wallet valued from the same bridge
    expect(wallet.needsMark).toBe(true); // stays true → mark-to-market re-marks the wallet ASSET basis later
    expect(cents(booked[0].legs)).toBe(0); // balances (owed +49000, wallet −49000)
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
  // Major B5 — a distinct fee asset with no mark ANYWHERE: the tx is mixed (valued wallet/owed/network-fee + unvalued
  // fee-asset leg) and the bridge finds no fee-asset mark → the row DEFERS instead of a silent phantom plug.
  it('defers when a distinct fee asset has no mark anywhere (mixed tx, B5)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
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

    expect(booked[0]).toBeUndefined(); // deferred: mixed tx with an unbridgeable fee asset
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced
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
  // Major B5 — a folded payout-asset fee where the payout asset has no mark ANYWHERE: the single (folded) wallet leg is
  // unvalued and the owed completion CHF is valued → mixed tx, no bridge → the row DEFERS.
  it('defers a folded-fee tx when the payout asset has no mark anywhere (B5)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
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

    expect(booked[0]).toBeUndefined(); // deferred: unvalued folded wallet leg vs valued owed completion CHF
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced
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
