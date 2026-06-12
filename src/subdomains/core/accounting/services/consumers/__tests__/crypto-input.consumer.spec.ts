import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
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
      return Promise.resolve({} as any);
    });
    jest.spyOn(bookingService, 'nextSeq').mockImplementation(() => Promise.resolve(nextSeqValue));

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
  const mockBatch = (rows: CryptoInput[]) => jest.spyOn(cryptoInputRepo, 'find').mockResolvedValue(rows);

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

  // §10.2 fixture (B)(d) — no mark: ASSET leg needsMark, plug stays open, no silent priceChf=0
  it('flags the ASSET leg needsMark when no mark exists (no silent priceChf=0)', async () => {
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
    await consumer.process();

    const seq0 = booked.find((b) => b.seq === 0);
    const assetLeg = seq0.legs.find((l) => l.account.name === 'Unknown/XYZ');
    expect(assetLeg.needsMark).toBe(true);
    expect(assetLeg.amountChf).toBeUndefined();
    expect(cents(seq0.legs)).toBe(0); // received −50000 + plug +50000 balances; mark-to-market revalues later
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

  it('does NOT book a forward fee leg when forwardFeeAmountChf is null (Null-Strategie)', async () => {
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

  it('is idempotent: skips seq0 when already booked (re-run, nextSeq > 0)', async () => {
    nextSeqValue = 1; // seq0 already exists
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
});
