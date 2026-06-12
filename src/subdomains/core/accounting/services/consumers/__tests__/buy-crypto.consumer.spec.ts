import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../../entities/ledger-account.entity';
import { LedgerTx } from '../../../entities/ledger-tx.entity';
import { createCustomLedgerAccount } from '../../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountService } from '../../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../../ledger-booking.service';
import { BuyCryptoConsumer } from '../buy-crypto.consumer';

function buyCrypto(values: Record<string, unknown>): BuyCrypto {
  return Object.assign(new BuyCrypto(), {
    id: 1,
    created: new Date('2026-06-01T00:00:00Z'),
    updated: new Date('2026-06-02T00:00:00Z'),
    isComplete: false,
    ...values,
  });
}

function account(name: string, type: AccountType, currency: string): LedgerAccount {
  return createCustomLedgerAccount({ id: Math.floor(Math.random() * 1e6), name, type, currency } as any);
}

describe('BuyCryptoConsumer', () => {
  let consumer: BuyCryptoConsumer;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let settingService: SettingService;
  let buyCryptoRepo: Repository<BuyCrypto>;
  let ledgerTxRepo: Repository<LedgerTx>;

  let booked: LedgerTxInput[];
  let accounts: Map<string, LedgerAccount>;
  let nextSeqValue: number;
  let gateOpen: boolean; // simulates a seq0 crypto_input ledger_tx existing

  beforeEach(async () => {
    booked = [];
    nextSeqValue = 0;
    gateOpen = true;
    accounts = new Map([['Checkout/EUR', account('Checkout/EUR', AccountType.ASSET, 'EUR')]]);

    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    settingService = createMock<SettingService>();
    buyCryptoRepo = createMock<Repository<BuyCrypto>>();
    ledgerTxRepo = createMock<Repository<LedgerTx>>();

    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      booked.push(input);
      return Promise.resolve({} as any);
    });
    jest.spyOn(bookingService, 'nextSeq').mockImplementation(() => Promise.resolve(nextSeqValue));

    jest.spyOn(accountService, 'findByName').mockImplementation((name: string) => Promise.resolve(accounts.get(name)));
    jest
      .spyOn(accountService, 'findOrCreate')
      .mockImplementation((name: string, type: AccountType, currency: string) => {
        const existing = accounts.get(name);
        if (existing) return Promise.resolve(existing);
        const acc = account(name, type, currency);
        accounts.set(name, acc);
        return Promise.resolve(acc);
      });

    // gate lookup: countBy returns 1 when the gate is open (seq0 crypto_input / cutover marker exists)
    jest.spyOn(ledgerTxRepo, 'countBy').mockImplementation(() => Promise.resolve(gateOpen ? 1 : 0));

    jest.spyOn(settingService, 'getObj').mockResolvedValue(undefined);
    jest.spyOn(settingService, 'set').mockResolvedValue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestUtil.provideConfig(),
        BuyCryptoConsumer,
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: SettingService, useValue: settingService },
        { provide: getRepositoryToken(BuyCrypto), useValue: buyCryptoRepo },
        { provide: getRepositoryToken(LedgerTx), useValue: ledgerTxRepo },
      ],
    }).compile();

    consumer = module.get<BuyCryptoConsumer>(BuyCryptoConsumer);
  });

  const cents = (legs: LedgerLegInput[]) => legs.reduce((s, l) => s + Math.round((l.amountChf ?? 0) * 100), 0);
  const mockBatch = (rows: BuyCrypto[]) => jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue(rows);
  const seq = (n: number) => booked.find((b) => b.seq === n);
  const leg = (tx: LedgerTxInput, name: string) => tx.legs.find((l) => l.account.name === name);

  it('is defined', () => {
    expect(consumer).toBeDefined();
  });

  // §4.6 seq0 — Card input only: Dr ASSET/Checkout / Cr LIABILITY/buyCrypto-received (= amountInChf)
  it('books a Card input seq0 against Checkout custody (Bank/crypto inputs are NOT booked here)', async () => {
    mockBatch([buyCrypto({ id: 1, amountInChf: 1000, checkoutTx: { currency: 'EUR' } as any })]);
    await consumer.process();

    const tx = seq(0);
    expect(leg(tx, 'Checkout/EUR').amountChf).toBe(1000);
    expect(leg(tx, 'LIABILITY/buyCrypto-received').amountChf).toBe(-1000);
    expect(cents(tx.legs)).toBe(0);
  });

  it('does NOT book seq0 for a non-Card input (no checkoutTx → CryptoInput/BankTx single booker)', async () => {
    mockBatch([buyCrypto({ id: 2, amountInChf: 1000, isComplete: false })]);
    await consumer.process();
    expect(seq(0)).toBeUndefined();
  });

  // §10.2 (Major R4-3) — completion chain closes received to 0, owed = −(amountInChf − fee), 4-leg single tx
  it('books a cent-exact 4-leg completion (fee against received + reclassification received→owed)', async () => {
    mockBatch([buyCrypto({ id: 3, amountInChf: 15000, totalFeeAmountChf: 148.5, isComplete: true })]);
    await consumer.process();

    const tx = seq(1);
    expect(tx.legs).toHaveLength(4);
    const receivedLegs = tx.legs.filter((l) => l.account.name === 'LIABILITY/buyCrypto-received');
    const receivedSum = receivedLegs.reduce((s, l) => s + (l.amountChf ?? 0), 0);
    expect(receivedSum).toBe(15000); // +148.50 (fee) + 14851.50 (reclass) → closes the −15000 received to 0
    expect(leg(tx, 'INCOME/fee-buyCrypto').amountChf).toBe(-148.5);
    expect(leg(tx, 'LIABILITY/buyCrypto-owed').amountChf).toBe(-14851.5);
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.6 paymentLink: the fee leg is INCOME/fee-paymentLink instead of fee-buyCrypto
  it('books the completion fee as INCOME/fee-paymentLink when paymentLinkPayment is present', async () => {
    mockBatch([
      buyCrypto({
        id: 4,
        amountInChf: 1000,
        totalFeeAmountChf: 10,
        isComplete: true,
        cryptoInput: { paymentLinkPayment: { id: 1 } } as any,
      }),
    ]);
    await consumer.process();

    const tx = seq(1);
    expect(leg(tx, 'INCOME/fee-paymentLink').amountChf).toBe(-10);
    expect(leg(tx, 'INCOME/fee-buyCrypto')).toBeUndefined();
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.7 G-a/G-b gate: seq1 is skipped while `received` is not yet opened (CryptoInput consumer not caught up)
  it('skips the completion (seq1) while the received gate is closed (no seq0/cutover opening)', async () => {
    gateOpen = false;
    mockBatch([buyCrypto({ id: 5, amountInChf: 1000, totalFeeAmountChf: 10, isComplete: true })]);
    await consumer.process();
    expect(seq(1)).toBeUndefined();
  });

  it('does NOT advance the watermark past a gate-blocked completion (retry next run)', async () => {
    gateOpen = false;
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([buyCrypto({ id: 6, amountInChf: 1000, totalFeeAmountChf: 10, isComplete: true })]);
    await consumer.process();
    expect(setSpy).not.toHaveBeenCalled(); // watermark unchanged
  });

  it('does nothing for a not-yet-complete crypto-input buy_crypto (no seq0, no seq1)', async () => {
    mockBatch([buyCrypto({ id: 7, amountInChf: 1000, isComplete: false })]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  it('is idempotent: skips seq1 when already booked (re-run, nextSeq > 1)', async () => {
    nextSeqValue = 2;
    mockBatch([buyCrypto({ id: 8, amountInChf: 1000, totalFeeAmountChf: 10, isComplete: true })]);
    await consumer.process();
    expect(seq(1)).toBeUndefined();
  });

  it('advances the watermark after a successful batch', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([buyCrypto({ id: 9, amountInChf: 1000, totalFeeAmountChf: 10, isComplete: true })]);
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
