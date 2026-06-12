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
});
