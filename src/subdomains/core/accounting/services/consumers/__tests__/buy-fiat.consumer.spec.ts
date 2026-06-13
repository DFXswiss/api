import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../../entities/ledger-account.entity';
import { LedgerLeg } from '../../../entities/ledger-leg.entity';
import { LedgerTx } from '../../../entities/ledger-tx.entity';
import { createCustomLedgerAccount } from '../../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountService } from '../../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { BuyFiatConsumer } from '../buy-fiat.consumer';

const CHF_BANK_ASSET_ID = 401;
const EUR_BANK_ASSET_ID = 402;

const FRI = new Date('2026-06-05T00:00:00Z'); // transmission
const SUN = new Date('2026-06-07T00:00:00Z'); // bank booking (Class-1 hold)

function buyFiat(values: Record<string, unknown>): BuyFiat {
  return Object.assign(new BuyFiat(), {
    id: 1,
    updated: new Date('2026-06-04T00:00:00Z'),
    cryptoInput: { id: 10, updated: new Date('2026-06-04T00:00:00Z') },
    outputAsset: { name: 'CHF' },
    ...values,
  });
}

function account(name: string, type: AccountType, currency: string, assetId?: number): LedgerAccount {
  return createCustomLedgerAccount({ id: Math.floor(Math.random() * 1e6), name, type, currency, assetId } as any);
}

describe('BuyFiatConsumer', () => {
  let consumer: BuyFiatConsumer;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let markService: LedgerMarkService;
  let settingService: SettingService;
  let buyFiatRepo: Repository<BuyFiat>;
  let ledgerTxRepo: Repository<LedgerTx>;

  let booked: LedgerTxInput[];
  let accounts: Map<string, LedgerAccount>;
  let nextSeqValue: number;
  let activeKeys: Set<string>; // `${sourceId}:${seq}` with an active booking — backs hasActiveTxAt (per-seq, R3)
  let gateCount: number; // countBy result (received/cutover gate)
  let seq0PaymentLinkChf: number | undefined; // the seq0 paymentLink opening leg amountChf (negative)
  let cutoverOwedOpeningChf: number | undefined; // the cutover buyFiat-owed opening leg amountChf (negative)
  let cutoverLogId: string | undefined; // ledgerCutoverLogId setting (enables the owed-opening lookup)

  const chfBank = account('Bank/CHF', AccountType.ASSET, 'CHF', CHF_BANK_ASSET_ID);
  const eurBank = account('Bank/EUR', AccountType.ASSET, 'EUR', EUR_BANK_ASSET_ID);

  const markMap = new Map([[EUR_BANK_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 0.95 }]]]);

  beforeEach(async () => {
    booked = [];
    nextSeqValue = 0;
    activeKeys = new Set<string>();
    gateCount = 1;
    seq0PaymentLinkChf = undefined;
    cutoverOwedOpeningChf = undefined;
    cutoverLogId = undefined;
    accounts = new Map([
      ['Bank/CHF', chfBank],
      ['Bank/EUR', eurBank],
    ]);

    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    markService = createMock<LedgerMarkService>();
    settingService = createMock<SettingService>();
    buyFiatRepo = createMock<Repository<BuyFiat>>();
    ledgerTxRepo = createMock<Repository<LedgerTx>>();

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
      .mockImplementation((assetId: number) => Promise.resolve(assetId === EUR_BANK_ASSET_ID ? eurBank : chfBank));
    jest
      .spyOn(accountService, 'findOrCreate')
      .mockImplementation((name: string, type: AccountType, currency: string) => {
        const existing = accounts.get(name);
        if (existing) return Promise.resolve(existing);
        const acc = account(name, type, currency);
        accounts.set(name, acc);
        return Promise.resolve(acc);
      });

    jest.spyOn(ledgerTxRepo, 'countBy').mockImplementation(() => Promise.resolve(gateCount));
    jest.spyOn(ledgerTxRepo, 'findOne').mockImplementation(({ where }: any) => {
      // cutover buyFiat-owed opening lookup (§4.7a/§6.1): sourceType='cutover', sourceId='<logId>:buy_fiat-owed:<id>'
      if (where?.sourceType === 'cutover') {
        if (cutoverOwedOpeningChf == null) return Promise.resolve(undefined);
        const owedAccount = account('LIABILITY/buyFiat-owed', AccountType.LIABILITY, 'CHF');
        const owedLeg = Object.assign(new LedgerLeg(), { account: owedAccount, amountChf: cutoverOwedOpeningChf });
        return Promise.resolve(Object.assign(new LedgerTx(), { legs: [owedLeg] }));
      }
      // seq0 paymentLink opening lookup (§4.7b): sourceType='crypto_input'
      if (seq0PaymentLinkChf == null) return Promise.resolve(undefined);
      const plAccount = account('LIABILITY/paymentLink', AccountType.LIABILITY, 'CHF');
      const leg = Object.assign(new LedgerLeg(), { account: plAccount, amountChf: seq0PaymentLinkChf });
      return Promise.resolve(Object.assign(new LedgerTx(), { legs: [leg] }));
    });

    jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(markMap));
    jest.spyOn(settingService, 'getObj').mockResolvedValue(undefined);
    jest.spyOn(settingService, 'get').mockImplementation(() => Promise.resolve(cutoverLogId));
    jest.spyOn(settingService, 'set').mockResolvedValue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestUtil.provideConfig(),
        BuyFiatConsumer,
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: LedgerMarkService, useValue: markService },
        { provide: SettingService, useValue: settingService },
        { provide: getRepositoryToken(BuyFiat), useValue: buyFiatRepo },
        { provide: getRepositoryToken(LedgerTx), useValue: ledgerTxRepo },
      ],
    }).compile();

    consumer = module.get<BuyFiatConsumer>(BuyFiatConsumer);
  });

  const cents = (legs: LedgerLegInput[]) => legs.reduce((s, l) => s + Math.round((l.amountChf ?? 0) * 100), 0);
  // forward id-scan returns the rows; the §4.12 content-change scan (where has `updated`, not `id`) returns [] —
  // its late-settling/cutover-straddling coverage is asserted in the integration spec (no double-book here)
  const mockBatch = (rows: BuyFiat[]) =>
    jest
      .spyOn(buyFiatRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [] : rows));
  const seq = (n: number) => booked.find((b) => b.seq === n);
  const leg = (tx: LedgerTxInput, name: string) => tx.legs.find((l) => l.account.name === name);
  const sumOn = (name: string) =>
    booked
      .flatMap((b) => b.legs)
      .filter((l) => l.account.name === name)
      .reduce((s, l) => s + (l.amountChf ?? 0), 0);

  it('is defined', () => {
    expect(consumer).toBeDefined();
  });

  // §10.2 Class-1-Liability-Hold = the 14'980.12 headline (single bf 68310, 15'000 / 148.50 / 14'851.50, Sunday)
  it('books the regular sell chain: received→owed→TRANSIT(hold)→bank, both liabilities close to 0', async () => {
    mockBatch([
      buyFiat({
        id: 1,
        amountInChf: 15000,
        totalFeeAmountChf: 148.5,
        outputAmount: 14851.5,
        outputReferenceAmount: 14851.5,
        outputAsset: { name: 'CHF' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'CHF',
          bank: { asset: { id: CHF_BANK_ASSET_ID } },
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();

    // seq1: fee against received + reclassification received→owed
    const s1 = seq(1);
    expect(s1.legs).toHaveLength(4);
    expect(
      s1.legs.filter((l) => l.account.name === 'LIABILITY/buyFiat-received').reduce((s, l) => s + l.amountChf, 0),
    ).toBe(15000);
    expect(leg(s1, 'INCOME/fee-buyFiat').amountChf).toBe(-148.5);
    expect(leg(s1, 'LIABILITY/buyFiat-owed').amountChf).toBe(-14851.5);

    // seq2 transmit on Friday (Class-1 hold): owed → TRANSIT
    const s2 = seq(2);
    expect(s2.bookingDate).toEqual(FRI);
    expect(leg(s2, 'LIABILITY/buyFiat-owed').amountChf).toBe(14851.5);
    expect(leg(s2, 'TRANSIT/payout/CHF').amountChf).toBe(-14851.5);

    // seq3 booked on Sunday (bank_tx.bookingDate, NOT Friday): TRANSIT → bank
    const s3 = seq(3);
    expect(s3.bookingDate).toEqual(SUN);
    expect(leg(s3, 'TRANSIT/payout/CHF').amountChf).toBe(14851.5);
    expect(leg(s3, 'Bank/CHF').amountChf).toBe(-14851.5);

    // seq0 (the −15000 received credit) is booked by the CryptoInput consumer (single booker, §4.1); this
    // consumer debits received by exactly +15000 → closes the externally-opened −15000 to 0.
    expect(sumOn('LIABILITY/buyFiat-received')).toBe(15000);
    // owed: opened −14851.50 (seq1), transmitted +14851.50 (seq2) → closes to 0 within this consumer
    expect(sumOn('LIABILITY/buyFiat-owed')).toBe(0);
    // TRANSIT held between Friday and Sunday, then closed by seq3 → nets to 0
    expect(sumOn('TRANSIT/payout/CHF')).toBe(0);
    for (const tx of booked) expect(cents(tx.legs)).toBe(0);
  });

  // §4.7a EUR output: seq3 carries an FX-P&L leg for the EUR drift between reclassification and booking
  it('books an EUR-output seq3 with an fx-revaluation residual leg (§4.7a)', async () => {
    mockBatch([
      buyFiat({
        id: 2,
        amountInChf: 10000,
        totalFeeAmountChf: 0,
        outputAmount: 10500, // EUR
        outputReferenceAmount: 10500,
        outputAsset: { name: 'EUR' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'EUR',
          bank: { asset: { id: EUR_BANK_ASSET_ID } },
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();

    const s3 = seq(3);
    // TRANSIT Dr = owed_chf (10000); bank Cr = 10500 EUR × 0.95 = 9975 CHF; sum = +25 → residual −25
    expect(leg(s3, 'TRANSIT/payout/EUR').amountChf).toBe(10000);
    expect(leg(s3, 'Bank/EUR').amountChf).toBe(-9975);
    expect(leg(s3, 'EXPENSE/fx-revaluation').amountChf).toBe(-25); // residual = −(10000 − 9975) = −25 < 0 → EXPENSE
    expect(cents(s3.legs)).toBe(0);
  });

  // §4.7a/§6.1 owed-straddling (Blocker R6-1): a pre-cutover open buy_fiat (owed opened by the cutover at the
  // opening CHF) settles post-cutover via seq2/seq3 only — seq1 is skipped (would never open the received gate) and
  // owed closes cent-exact to 0 with the opening-CHF anchor; the Opening↔Settlement mark drift lands in the FX leg.
  it('settles an owed-straddling buy_fiat end-to-end: skip seq1, owed closes to 0 via the opening anchor', async () => {
    cutoverLogId = '1557344';
    cutoverOwedOpeningChf = -9500; // cutover opened buyFiat-owed at outputAmount(10000 EUR) × mark@snapshot(0.95)
    gateCount = 0; // the received seq0 gate would NEVER open (the financing crypto_input settled pre-cutover)
    mockBatch([
      buyFiat({
        id: 6,
        amountInChf: 10000,
        totalFeeAmountChf: 50,
        outputAmount: 10000, // EUR
        outputReferenceAmount: 10000,
        outputAsset: { name: 'EUR' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'EUR',
          bank: { asset: { id: EUR_BANK_ASSET_ID } },
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();

    // seq1 is NOT booked (owed-straddling: reclassification ran pre-cutover, anchored in the cutover opening)
    expect(seq(1)).toBeUndefined();

    // seq2 transmit: owed-Dr = opening anchor (+9500), NOT the completion CHF (10000 − 50 = 9950)
    const s2 = seq(2);
    expect(leg(s2, 'LIABILITY/buyFiat-owed').amountChf).toBe(9500);
    expect(leg(s2, 'TRANSIT/payout/EUR').amountChf).toBe(-9500);

    // seq3 booked: TRANSIT +9500; bank Cr = 10000 EUR × 0.95 = −9500 → drift 0 here, closes flat
    const s3 = seq(3);
    expect(leg(s3, 'TRANSIT/payout/EUR').amountChf).toBe(9500);
    expect(leg(s3, 'Bank/EUR').amountChf).toBe(-9500);

    // owed: opened −9500 (cutover, external), debited +9500 (seq2) → closes cent-exact to 0
    expect(sumOn('LIABILITY/buyFiat-owed')).toBe(9500); // this consumer's debit; the −9500 opening was external
    expect(sumOn('TRANSIT/payout/EUR')).toBe(0);
    for (const tx of booked) expect(cents(tx.legs)).toBe(0);
  });

  // §4.7 G-a/G-b gate: seq1 skipped while received not opened; watermark not advanced past the row
  it('skips seq1 and does not advance the watermark while the received gate is closed', async () => {
    gateCount = 0; // neither G-a nor G-b
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      buyFiat({
        id: 3,
        amountInChf: 15000,
        totalFeeAmountChf: 148.5,
        outputAmount: 14851.5,
        outputReferenceAmount: 14851.5,
      }),
    ]);
    await consumer.process();
    expect(seq(1)).toBeUndefined();
    expect(setSpy).not.toHaveBeenCalled();
  });

  // §4.7b PaymentLink merchant payout: clears LIABILITY/paymentLink (not received/owed) to 0
  it('books the paymentLink merchant path: fee → INCOME/fee-paymentLink, paymentLink closes to 0 (Blocker R8-1)', async () => {
    seq0PaymentLinkChf = -1000; // seq0 opened paymentLink at −Mark×amount (1000 CHF crypto value)
    mockBatch([
      buyFiat({
        id: 4,
        amountInChf: 1000,
        totalFeeAmountChf: 20,
        paymentLinkFee: 0.01,
        outputReferenceAmount: 950, // fiat reference
        outputAmount: 940, // net merchant fiat (= reference − plFee 10)
        outputAsset: { name: 'CHF' },
        cryptoInput: { id: 10, updated: new Date('2026-06-04T00:00:00Z'), paymentLinkPayment: { id: 1 } },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'CHF',
          bank: { asset: { id: CHF_BANK_ASSET_ID } },
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();

    // it chose the §4.7b path (no received/owed legs anywhere)
    expect(sumOn('LIABILITY/buyFiat-received')).toBe(0);
    expect(sumOn('LIABILITY/buyFiat-owed')).toBe(0);

    // seq1 realizes BOTH DFX fee shares (product fee 20 + merchant plFee = 950 − 940 = 10, CHF-valued) as INCOME.
    // plFeeNative = outputReferenceAmount − outputAmount = 950 − 940 = 10; owedReferenceRate = amountInChf/ref =
    // 1000/950 ≈ 1.05263158; plFeeChf = round(10 × 1.05263158, 2) = 10.53; feeChf = round(20 + 10.53, 2) = 30.53.
    const s1 = seq(1);
    const feeIncome = leg(s1, 'INCOME/fee-paymentLink');
    expect(feeIncome).toBeDefined();
    // concrete amount + account + sign (NOT merely toBeDefined): INCOME credit is −feeChf, exact to the cent. A
    // swapped sign, a wrong fee base, or the merchant plFee being dropped would all change this exact value.
    expect(feeIncome.account.name).toBe('INCOME/fee-paymentLink');
    expect(feeIncome.account.type).toBe(AccountType.INCOME);
    expect(feeIncome.amountChf).toBe(-30.53); // −(product fee 20 + merchant plFee 10.53), credit sign
    // the matching Dr is on LIABILITY/paymentLink for the same +feeChf (debits paymentLink toward 0)
    const plFeeDr = s1.legs
      .filter((l) => l.account.name === 'LIABILITY/paymentLink')
      .reduce((s, l) => s + (l.amountChf ?? 0), 0);
    expect(Math.round(plFeeDr * 100)).toBeGreaterThan(0); // paymentLink debited (positive) in seq1

    // the merchant clearing legs hit LIABILITY/paymentLink (character-exact, NOT merchant-payable)
    expect(seq(2).legs.some((l) => l.account.name === 'LIABILITY/paymentLink')).toBe(true);
    expect(leg(seq(3), 'Bank/CHF')).toBeDefined();

    // seq0 (the −1000 paymentLink credit) is booked by the CryptoInput consumer (§4.4 isPayment); this consumer
    // debits paymentLink by exactly the opening value (+1000) across seq1+seq2 → closes the external −1000 to 0.
    expect(Math.round(sumOn('LIABILITY/paymentLink') * 100)).toBe(100000); // +1000 CHF
    for (const tx of booked) expect(cents(tx.legs)).toBe(0);
  });

  // §4.7b gate: seq1 skipped while the seq0 paymentLink opening does not yet exist
  it('skips the paymentLink seq1 while the seq0 paymentLink opening is missing (gate)', async () => {
    seq0PaymentLinkChf = undefined; // CryptoInput consumer has not opened paymentLink yet
    mockBatch([
      buyFiat({
        id: 5,
        amountInChf: 1000,
        totalFeeAmountChf: 20,
        outputReferenceAmount: 950,
        outputAmount: 940,
        cryptoInput: { id: 10, updated: new Date('2026-06-04T00:00:00Z'), paymentLinkPayment: { id: 1 } },
      }),
    ]);
    await consumer.process();
    expect(seq(1)).toBeUndefined();
  });

  // §10.2 N:1-Defensive (synthetic): three buyFiats → one fiat_output/bank_tx → ASSET/bank debited once per row
  it('books seq2/seq3 PER buyFiat (N:1 @OneToMany defensive, Major R10-1)', async () => {
    const sharedOutput = (amount: number) => ({
      isTransmittedDate: FRI,
      currency: 'CHF',
      bank: { asset: { id: CHF_BANK_ASSET_ID } },
      bankTx: { bookingDate: SUN },
      amount, // fiat_output.amount = Σ bf.outputAmount = 1800
    });
    const make = (id: number, out: number) =>
      buyFiat({
        id,
        amountInChf: out,
        totalFeeAmountChf: 0,
        outputAmount: out,
        outputReferenceAmount: out,
        outputAsset: { name: 'CHF' },
        fiatOutput: sharedOutput(1800) as any,
      });
    mockBatch([make(101, 1000), make(102, 500), make(103, 300)]);
    await consumer.process();

    // three seq3 legs, each its own outputAmount; ASSET/bank debited GENAU um fiat_output.amount = 1800 total
    const bankLegs = booked.filter((b) => b.seq === 3).map((b) => leg(b, 'Bank/CHF'));
    expect(bankLegs).toHaveLength(3);
    expect(bankLegs.map((l) => l.amountChf).sort((a, b) => a - b)).toEqual([-1000, -500, -300].sort((a, b) => a - b));
    expect(sumOn('Bank/CHF')).toBe(-1800); // Σ bf.outputAmount == fiat_output.amount, NOT booked once

    // all owed close to 0, TRANSIT closes to 0
    expect(sumOn('LIABILITY/buyFiat-owed')).toBe(0);
    expect(sumOn('TRANSIT/payout/CHF')).toBe(0);
  });

  it('is idempotent: skips a fully booked row (re-run, active at seq1/2/3)', async () => {
    activeKeys.add('6:1').add('6:2').add('6:3'); // all forward seqs of buy_fiat 6 already active
    mockBatch([
      buyFiat({
        id: 6,
        amountInChf: 1000,
        totalFeeAmountChf: 10,
        outputAmount: 990,
        outputReferenceAmount: 990,
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'CHF',
          bank: { asset: { id: CHF_BANK_ASSET_ID } },
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  // R3 — content-change reversal of seq1 BEFORE transmit/booked must NOT strand seq2/seq3: reversal/re-book live in
  // the correction range (≥1_000_000), so seq2/seq3 are still free and book; owed + TRANSIT close cent-exact to 0.
  it('books seq2/seq3 even after a seq1 content-change reversal (no stranded later seqs, R3)', async () => {
    // model the post-reversal state: seq1 reversed+rebooked into the correction range (active at seq1), seq2/seq3 NOT
    // yet booked. nextSeq has jumped past 3 — the exact trap the old `nextSeq>seq` gate mis-read as "2/3 booked".
    activeKeys.add('8:1');
    nextSeqValue = 1_000_002;
    mockBatch([
      buyFiat({
        id: 8,
        amountInChf: 15000,
        totalFeeAmountChf: 148.5,
        outputAmount: 14851.5,
        outputReferenceAmount: 14851.5,
        outputAsset: { name: 'CHF' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'CHF',
          bank: { asset: { id: CHF_BANK_ASSET_ID } },
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);

    await consumer.process();

    expect(seq(1)).toBeUndefined(); // seq1 is active → NOT re-booked at the literal seq1
    const s2 = seq(2);
    const s3 = seq(3);
    expect(s2).toBeDefined(); // transmit booked despite nextSeq being far above 2
    expect(s3).toBeDefined(); // booked booked despite nextSeq being far above 3
    expect(leg(s2, 'LIABILITY/buyFiat-owed').amountChf).toBe(14851.5);
    expect(leg(s3, 'Bank/CHF').amountChf).toBe(-14851.5);
    // owed: debited +14851.50 (seq2) — the −14851.50 came from the (reversed-then-rebooked) seq1; TRANSIT nets to 0
    expect(sumOn('TRANSIT/payout/CHF')).toBe(0);
    for (const tx of booked) expect(cents(tx.legs)).toBe(0);
  });

  it('advances the watermark after a successful batch', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      buyFiat({ id: 7, amountInChf: 1000, totalFeeAmountChf: 10, outputAmount: 990, outputReferenceAmount: 990 }),
    ]);
    await consumer.process();
    const written = JSON.parse(setSpy.mock.calls[0][1]);
    expect(written.lastProcessedId).toBe(7);
  });

  it('no-ops on an empty batch', async () => {
    mockBatch([]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  // processForward catch (lines 105-107): a bookTx error stops the batch and leaves the watermark unchanged
  // (failure-isolation). bookReclassification → bookTx rejects on seq1 → caught in the for-loop → break, set NOT called.
  it('stops the batch and does not advance the watermark when bookTx throws (failure-isolation)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(bookingService, 'bookTx').mockRejectedValue(new Error('boom'));
    mockBatch([
      buyFiat({
        id: 11,
        amountInChf: 15000,
        totalFeeAmountChf: 148.5,
        outputAmount: 14851.5,
        outputReferenceAmount: 14851.5,
        outputAsset: { name: 'CHF' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'CHF',
          bank: { asset: { id: CHF_BANK_ASSET_ID } },
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();
    expect(booked).toHaveLength(0); // the rejecting bookTx never pushed
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced
  });

  // buildReclassificationSeq1 throw (line 166): a regular row with outputAmount set and the gate OPEN but
  // amountInChf == null throws `has outputAmount but amountInChf is null` → caught by processForward → set NOT called.
  it('isolates the buildReclassificationSeq1 throw when amountInChf is null (watermark unchanged)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    gateCount = 1; // received gate OPEN → we reach buildReclassificationSeq1, not the gate skip
    mockBatch([
      buyFiat({
        id: 12,
        amountInChf: null, // the trigger: outputAmount set but amountInChf null
        totalFeeAmountChf: 0,
        outputAmount: 5000,
        outputReferenceAmount: 5000,
        outputAsset: { name: 'CHF' },
      }),
    ]);
    await consumer.process();
    expect(seq(1)).toBeUndefined();
    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled();
  });

  // appendFxResidual early-return (line 334): a regular EUR sell whose bank.asset has NO mark → the bank leg
  // needsMark → NO fx-residual leg appended (also covers outputMark returning undefined for a non-CHF output whose
  // mark is missing, lines 364-368). seq3 carries only TRANSIT + the unmarked bank leg.
  it('appends NO fx residual when the bank leg still needsMark (unmarked EUR output)', async () => {
    mockBatch([
      buyFiat({
        id: 13,
        amountInChf: 9000,
        totalFeeAmountChf: 0,
        outputAmount: 10000, // EUR
        outputReferenceAmount: 10000,
        outputAsset: { name: 'EUR' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'EUR',
          bank: { asset: { id: 999 } }, // 999 is NOT in markMap → getMarkAt → undefined → needsMark
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();

    const s3 = seq(3);
    expect(s3.legs).toHaveLength(2); // TRANSIT + bank only, NO fx-revaluation plug while unmarked
    expect(leg(s3, 'TRANSIT/payout/EUR').amountChf).toBe(9000); // owed_chf = 9000 − 0
    const bankLeg = s3.legs.find((l) => l.account.name === 'Bank/CHF'); // asset 999 → findByAssetId fallback
    expect(bankLeg.amount).toBe(-10000); // native −outputAmount
    expect(bankLeg.needsMark).toBe(true); // unmarked → carried for the mark-to-market job
    expect(bankLeg.amountChf).toBeUndefined();
    expect(s3.legs.some((l) => /fx-revaluation/.test(l.account.name))).toBe(false);
  });

  // outputMark bankAssetId == null branch (lines 364-368 false arm): the bank.asset exists (no bankCrLeg throw) but
  // its id is undefined → outputMark returns undefined without a getMarkAt lookup → bank leg needsMark, no fx leg.
  it('marks the bank leg as needsMark when the bank.asset has no id (outputMark null-id arm)', async () => {
    mockBatch([
      buyFiat({
        id: 14,
        amountInChf: 8000,
        totalFeeAmountChf: 0,
        outputAmount: 8400, // EUR
        outputReferenceAmount: 8400,
        outputAsset: { name: 'EUR' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'EUR',
          bank: { asset: {} }, // asset present (no throw) but id undefined → outputMark null-id arm
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();

    const s3 = seq(3);
    const bankLeg = s3.legs.find((l) => l.needsMark);
    expect(bankLeg).toBeDefined();
    expect(bankLeg.amount).toBe(-8400);
    expect(bankLeg.amountChf).toBeUndefined();
    expect(s3.legs.some((l) => /fx-revaluation/.test(l.account.name))).toBe(false);
  });

  // appendFxResidual INCOME side (line 340 ≥0 arm): an EUR sell where owed_chf < bank-CHF → positive residual →
  // INCOME/fx-revaluation. owed_chf = 9000; bank = 10000 EUR × 0.95 = −9500; Σ = −500 → residual +500 → INCOME.
  it('books a POSITIVE fx residual to INCOME/fx-revaluation (§4.7a income side)', async () => {
    mockBatch([
      buyFiat({
        id: 15,
        amountInChf: 9000,
        totalFeeAmountChf: 0,
        outputAmount: 10000, // EUR
        outputReferenceAmount: 10000,
        outputAsset: { name: 'EUR' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'EUR',
          bank: { asset: { id: EUR_BANK_ASSET_ID } },
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();

    const s3 = seq(3);
    expect(leg(s3, 'TRANSIT/payout/EUR').amountChf).toBe(9000);
    expect(leg(s3, 'Bank/EUR').amountChf).toBe(-9500); // 10000 × 0.95
    const fx = leg(s3, 'INCOME/fx-revaluation');
    expect(fx.account.type).toBe(AccountType.INCOME);
    expect(fx.amountChf).toBe(500); // residual = −(9000 − 9500) = +500 ≥ 0 → INCOME
    expect(s3.legs.some((l) => l.account.name === 'EXPENSE/fx-revaluation')).toBe(false);
    expect(cents(s3.legs)).toBe(0);
  });

  // bookPaymentLinkFee venueSpread == 0 (line 276 false arm): a paymentLink row where openingChf − outputChf −
  // feeChf == 0 → ONLY the 2 fee legs, NO venueSpread legs. rate = 1000/1000 = 1; outputChf = 980; plFeeNative =
  // 1000 − 980 = 20 → plFeeChf 20; feeChf = 20 + 20 = 40; opening 1020 → venueSpread = 1020 − 980 − 40 = 0.
  it('books only the 2 fee legs when the paymentLink venue spread is exactly 0', async () => {
    seq0PaymentLinkChf = -1020; // opening = 1020
    mockBatch([
      buyFiat({
        id: 16,
        amountInChf: 1000,
        totalFeeAmountChf: 20,
        outputReferenceAmount: 1000,
        outputAmount: 980,
        outputAsset: { name: 'CHF' },
        cryptoInput: { id: 10, updated: new Date('2026-06-04T00:00:00Z'), paymentLinkPayment: { id: 1 } },
      }),
    ]);
    await consumer.process();

    const s1 = seq(1);
    expect(s1.legs).toHaveLength(2); // venueSpread == 0 → the spread legs are NOT pushed
    expect(leg(s1, 'INCOME/fee-paymentLink').amountChf).toBe(-40); // −(20 product + 20 plFee)
    const plDr = s1.legs.filter((l) => l.account.name === 'LIABILITY/paymentLink').reduce((s, l) => s + l.amountChf, 0);
    expect(plDr).toBe(40); // single +40 fee debit, no spread debit
    expect(s1.legs.some((l) => /fx-revaluation/.test(l.account.name))).toBe(false);
    expect(cents(s1.legs)).toBe(0);
  });

  // bookPaymentLinkFee venueSpread ≥ 0 (line 278 income arm): a positive venue spread → INCOME/fx-revaluation.
  // rate = 1; outputChf = 900; plFeeNative = 1000 − 900 = 100 → plFeeChf 100; feeChf = 10 + 100 = 110; opening 1050
  // → venueSpread = 1050 − 900 − 110 = +40 → INCOME.
  it('books a POSITIVE paymentLink venue spread to INCOME/fx-revaluation', async () => {
    seq0PaymentLinkChf = -1050; // opening = 1050
    mockBatch([
      buyFiat({
        id: 17,
        amountInChf: 1000,
        totalFeeAmountChf: 10,
        outputReferenceAmount: 1000,
        outputAmount: 900,
        outputAsset: { name: 'CHF' },
        cryptoInput: { id: 10, updated: new Date('2026-06-04T00:00:00Z'), paymentLinkPayment: { id: 1 } },
      }),
    ]);
    await consumer.process();

    const s1 = seq(1);
    expect(s1.legs).toHaveLength(4); // 2 fee + 2 spread
    expect(leg(s1, 'INCOME/fee-paymentLink').amountChf).toBe(-110);
    const fx = leg(s1, 'INCOME/fx-revaluation');
    expect(fx.account.type).toBe(AccountType.INCOME);
    expect(fx.amountChf).toBe(-40); // venueSpread +40 ≥ 0 → INCOME credit −venueSpread
    // paymentLink debited by feeChf + venueSpread = 110 + 40 = 150
    const plDr = s1.legs.filter((l) => l.account.name === 'LIABILITY/paymentLink').reduce((s, l) => s + l.amountChf, 0);
    expect(plDr).toBe(150);
    expect(s1.legs.some((l) => l.account.name === 'EXPENSE/fx-revaluation')).toBe(false);
    expect(cents(s1.legs)).toBe(0);
  });

  // owedReferenceRate ref==null + CHF output (line 359 → returns 1): a paymentLink CHF row with
  // outputReferenceAmount null → owed_chf = outputAmount × 1. Asserted on seq2 transmit (paymentLink Dr = outputChf).
  it('uses owedReferenceRate 1 for a CHF paymentLink row with a null reference', async () => {
    seq0PaymentLinkChf = -500;
    mockBatch([
      buyFiat({
        id: 18,
        amountInChf: 500,
        totalFeeAmountChf: 0,
        outputReferenceAmount: null, // ref null → CHF → rate 1
        outputAmount: 500,
        outputAsset: { name: 'CHF' },
        cryptoInput: { id: 10, updated: new Date('2026-06-04T00:00:00Z'), paymentLinkPayment: { id: 1 } },
        fiatOutput: { isTransmittedDate: FRI, currency: 'CHF' } as any,
      }),
    ]);
    await consumer.process();

    const s2 = seq(2);
    expect(leg(s2, 'LIABILITY/paymentLink').amountChf).toBe(500); // outputAmount × 1
    expect(leg(s2, 'TRANSIT/payout/CHF').amountChf).toBe(-500);
    expect(cents(s2.legs)).toBe(0);
  });

  // owedReferenceRate ref==null + non-CHF output (line 359 → returns 0): a paymentLink EUR row with
  // outputReferenceAmount null → owed_chf = outputAmount × 0 = 0. Asserted on seq2 transmit (both legs 0).
  it('uses owedReferenceRate 0 for a non-CHF paymentLink row with a null reference', async () => {
    seq0PaymentLinkChf = -100; // opening present (gate passes); spread plugs to fx, not asserted here
    mockBatch([
      buyFiat({
        id: 19,
        amountInChf: 100,
        totalFeeAmountChf: 0,
        outputReferenceAmount: null, // ref null → EUR → rate 0
        outputAmount: 10000, // EUR
        outputAsset: { name: 'EUR' },
        cryptoInput: { id: 10, updated: new Date('2026-06-04T00:00:00Z'), paymentLinkPayment: { id: 1 } },
        fiatOutput: { isTransmittedDate: FRI, currency: 'EUR' } as any,
      }),
    ]);
    await consumer.process();

    const s2 = seq(2);
    expect(leg(s2, 'LIABILITY/paymentLink').amountChf).toBe(0); // outputAmount × 0
    expect(leg(s2, 'TRANSIT/payout/EUR').amountChf).toBe(-0);
    expect(cents(s2.legs)).toBe(0);
  });

  // bankCrLeg throw (line 313): a regular sell reaching seq3 whose fiatOutput.bank.asset is missing throws
  // `fiatOutput has no bank.asset` → caught by processForward → failure-isolation (seq3 absent, watermark unchanged).
  // seq1/seq2 ARE booked (they precede the throw); seq3 is not, and set is NOT called.
  it('isolates the bankCrLeg throw when the output bank.asset is missing (untracked output bank)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      buyFiat({
        id: 20,
        amountInChf: 1000,
        totalFeeAmountChf: 10,
        outputAmount: 990,
        outputReferenceAmount: 990,
        outputAsset: { name: 'CHF' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'CHF',
          bank: {}, // no asset → bankCrLeg throws
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();

    expect(seq(1)).toBeDefined(); // seq1 booked before the seq3 throw
    expect(seq(2)).toBeDefined(); // seq2 booked before the seq3 throw
    expect(seq(3)).toBeUndefined(); // seq3 threw → never booked
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced
  });

  // receivedOpened G-b path (lines 388-394): G-a closed (crypto_input seq0 absent) but the cutover received marker
  // exists → seq1 opens via G-b. countBy returns 0 for the crypto_input G-a query and >0 for the cutover G-b query.
  it('opens seq1 via the cutover received marker (G-b) when G-a is closed', async () => {
    cutoverLogId = '1557344'; // enables cutoverReceivedSourceId → the G-b countBy runs
    // distinguish the two gate queries by sourceType: G-a (crypto_input) closed, G-b (cutover) open
    jest
      .spyOn(ledgerTxRepo, 'countBy')
      .mockImplementation(({ sourceType }: any) => Promise.resolve(sourceType === 'cutover' ? 1 : 0));
    mockBatch([
      buyFiat({
        id: 21,
        amountInChf: 1000,
        totalFeeAmountChf: 10,
        outputAmount: 990,
        outputReferenceAmount: 990,
        outputAsset: { name: 'CHF' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'CHF',
          bank: { asset: { id: CHF_BANK_ASSET_ID } },
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();

    const s1 = seq(1); // gate opened via G-b → seq1 IS booked
    expect(s1).toBeDefined();
    expect(leg(s1, 'LIABILITY/buyFiat-owed').amountChf).toBe(-990); // −(1000 − 10)
    expect(sumOn('LIABILITY/buyFiat-received')).toBe(1000);
  });

  // §4.12 content-change scan (process lines 60-84): a settled regular row surfaced ONLY by the content-change scan
  // (where.updated) → buildReclassificationSeq1 is reverse-and-rebooked, then the idempotent book() appends seq2/seq3.
  it('reverse-and-rebooks the seq1 on a content-change scan and appends the later seqs', async () => {
    const reverseSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    activeKeys.add('22:1'); // seq1 already exists → book() skips it; only seq2/seq3 append
    jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) =>
      Promise.resolve(
        where?.updated != null
          ? [
              buyFiat({
                id: 22,
                amountInChf: 1000,
                totalFeeAmountChf: 10,
                outputAmount: 990,
                outputReferenceAmount: 990,
                outputAsset: { name: 'CHF' },
                fiatOutput: {
                  isTransmittedDate: FRI,
                  currency: 'CHF',
                  bank: { asset: { id: CHF_BANK_ASSET_ID } },
                  bankTx: { bookingDate: SUN },
                } as any,
              }),
            ]
          : [],
      ),
    );
    await consumer.process();

    expect(reverseSpy).toHaveBeenCalledTimes(1);
    const reInput = reverseSpy.mock.calls[0][0];
    expect(reInput.seq).toBe(1); // the rebuilt seq1 reclassification
    expect(leg(reInput, 'LIABILITY/buyFiat-owed').amountChf).toBe(-990);
    // the idempotent forward book() then appends transmit + booked
    expect(seq(2)).toBeDefined();
    expect(seq(3)).toBeDefined();
    expect(leg(seq(2), 'LIABILITY/buyFiat-owed').amountChf).toBe(990);
    expect(leg(seq(3), 'Bank/CHF').amountChf).toBe(-990);
  });

  // §4.12 content-change scan, owed-straddling variant (process lines 73-77): owedOpeningChf != null → the seq1
  // reverse is SKIPPED (the reclassification was anchored in the cutover opening), but book() still settles seq2/seq3.
  it('skips the seq1 reverse for an owed-straddling row in the content-change scan but still settles', async () => {
    cutoverLogId = '1557344';
    cutoverOwedOpeningChf = -9500; // owed opening anchor → owedOpeningChf != null
    gateCount = 0; // received gate stays closed for this row (would never open via G-a)
    const reverseSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) =>
      Promise.resolve(
        where?.updated != null
          ? [
              buyFiat({
                id: 23,
                amountInChf: 10000,
                totalFeeAmountChf: 50,
                outputAmount: 10000, // EUR
                outputReferenceAmount: 10000,
                outputAsset: { name: 'EUR' },
                fiatOutput: {
                  isTransmittedDate: FRI,
                  currency: 'EUR',
                  bank: { asset: { id: EUR_BANK_ASSET_ID } },
                  bankTx: { bookingDate: SUN },
                } as any,
              }),
            ]
          : [],
      ),
    );
    await consumer.process();

    expect(reverseSpy).not.toHaveBeenCalled(); // owed-straddling → seq1 reverse skipped
    expect(seq(1)).toBeUndefined(); // never booked by this consumer (anchored in the opening)
    // seq2/seq3 settle against the +9500 opening anchor; bank 10000 EUR × 0.95 = −9500 → drift 0
    expect(leg(seq(2), 'LIABILITY/buyFiat-owed').amountChf).toBe(9500);
    expect(leg(seq(3), 'Bank/EUR').amountChf).toBe(-9500);
    expect(sumOn('TRANSIT/payout/EUR')).toBe(0);
  });

  // §4.12 content-change scan gate-block (line 81): book() returns false (received gate closed) → the scan throws,
  // which runContentChangeScan catches → the cursor is NOT advanced (set not called) and process() resolves cleanly.
  it('throws on a gate-blocked content-change row so the cursor is not advanced (R6-1)', async () => {
    gateCount = 0; // received gate closed → bookRegular returns false (book gate-blocked)
    cutoverLogId = undefined; // no G-b → receivedOpened false
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) =>
      Promise.resolve(
        where?.updated != null
          ? [
              buyFiat({
                id: 24,
                amountInChf: 1000,
                totalFeeAmountChf: 10,
                outputAmount: 990, // outputAmount set → seq1 attempted, but the gate is closed
                outputReferenceAmount: 990,
                outputAsset: { name: 'CHF' },
              }),
            ]
          : [],
      ),
    );
    // runContentChangeScan swallows the line-81 throw → process resolves, but the watermark cursor stays put
    await expect(consumer.process()).resolves.toBeUndefined();
    expect(seq(1)).toBeUndefined(); // gate-blocked → nothing booked
    expect(setSpy).not.toHaveBeenCalled(); // cursor NOT advanced past the late-settling row
  });

  // buildReclassificationSeq1 paymentLink guard (L165): the content-change scan calls buildReclassificationSeq1 for a
  // PAYMENTLINK row → `if (bf.cryptoInput?.paymentLinkPayment) return undefined` → no seq1 reverse (paymentLink owns
  // its own venue-spread seq1). book() still runs the §4.7b path → INCOME/fee-paymentLink booked, owed/received absent.
  it('returns undefined from buildReclassificationSeq1 for a paymentLink content-change row (no seq1 reverse, L165)', async () => {
    seq0PaymentLinkChf = -1000; // opening present so the §4.7b seq1 books
    const reverseSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) =>
      Promise.resolve(
        where?.updated != null
          ? [
              buyFiat({
                id: 25,
                amountInChf: 1000,
                totalFeeAmountChf: 20,
                outputReferenceAmount: 950,
                outputAmount: 940,
                outputAsset: { name: 'CHF' },
                cryptoInput: { id: 10, updated: new Date('2026-06-04T00:00:00Z'), paymentLinkPayment: { id: 1 } },
                fiatOutput: {
                  isTransmittedDate: FRI,
                  currency: 'CHF',
                  bank: { asset: { id: CHF_BANK_ASSET_ID } },
                  bankTx: { bookingDate: SUN },
                } as any,
              }),
            ]
          : [],
      ),
    );
    await consumer.process();

    expect(reverseSpy).not.toHaveBeenCalled(); // paymentLink → buildReclassificationSeq1 undefined → no seq1 reverse
    // book() still ran the §4.7b path: the seq1 fee income exists, and NO regular received/owed legs were booked
    expect(leg(seq(1), 'INCOME/fee-paymentLink')).toBeDefined();
    expect(sumOn('LIABILITY/buyFiat-received')).toBe(0);
    expect(sumOn('LIABILITY/buyFiat-owed')).toBe(0);
  });

  // buildReclassificationSeq1 fee null-fallback (L168): a regular sell with totalFeeAmountChf == null → fee 0 →
  // reclassChf = amountInChf − 0 = amountInChf; owed credited −amountInChf, fee-income credit is exactly −0.
  it('treats a null totalFeeAmountChf as fee 0 in the seq1 reclassification (L168)', async () => {
    mockBatch([
      buyFiat({
        id: 26,
        amountInChf: 1000,
        totalFeeAmountChf: null, // fee null → ?? 0
        outputAmount: 1000,
        outputReferenceAmount: 1000,
        outputAsset: { name: 'CHF' },
        fiatOutput: { isTransmittedDate: FRI, currency: 'CHF' } as any,
      }),
    ]);
    await consumer.process();

    const s1 = seq(1);
    expect(s1.legs).toHaveLength(4);
    expect(leg(s1, 'INCOME/fee-buyFiat').amountChf).toBe(-0); // −fee = −0 (fee 0 from ?? 0)
    expect(leg(s1, 'LIABILITY/buyFiat-owed').amountChf).toBe(-1000); // −(amountInChf − 0)
    expect(sumOn('LIABILITY/buyFiat-received')).toBe(1000); // +fee(0) + reclass(1000)
    expect(cents(s1.legs)).toBe(0);
  });

  // bookSettlement bookingDate null-fallback (L211): seq3 bankTx with bookingDate == null but created set →
  // bookingDate = bankTx.created. The seq3 tx is dated at created, NOT undefined.
  it('falls back to bankTx.created for the seq3 booking date when bookingDate is null (L211)', async () => {
    const CREATED = new Date('2026-06-08T00:00:00Z');
    mockBatch([
      buyFiat({
        id: 27,
        amountInChf: 1000,
        totalFeeAmountChf: 10,
        outputAmount: 990,
        outputReferenceAmount: 990,
        outputAsset: { name: 'CHF' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'CHF',
          bank: { asset: { id: CHF_BANK_ASSET_ID } },
          bankTx: { bookingDate: null, created: CREATED }, // bookingDate null → ?? created
        } as any,
      }),
    ]);
    await consumer.process();

    const s3 = seq(3);
    expect(s3.bookingDate).toEqual(CREATED); // null bookingDate → fell back to bankTx.created
    expect(leg(s3, 'Bank/CHF').amountChf).toBe(-990);
  });

  // bookPaymentLinkFee fee null-fallback (L259): a paymentLink row with totalFeeAmountChf == null → totalFee 0 →
  // feeChf = 0 + plFeeChf. rate = 1000/950 ≈ 1.05263158; plFeeNative = 950 − 940 = 10; plFeeChf = 10.53; feeChf = 10.53.
  it('treats a null totalFeeAmountChf as 0 in the paymentLink seq1 fee (L259)', async () => {
    seq0PaymentLinkChf = -1000;
    mockBatch([
      buyFiat({
        id: 28,
        amountInChf: 1000,
        totalFeeAmountChf: null, // fee null → ?? 0
        outputReferenceAmount: 950,
        outputAmount: 940,
        outputAsset: { name: 'CHF' },
        cryptoInput: { id: 10, updated: new Date('2026-06-04T00:00:00Z'), paymentLinkPayment: { id: 1 } },
      }),
    ]);
    await consumer.process();

    const s1 = seq(1);
    expect(leg(s1, 'INCOME/fee-paymentLink').amountChf).toBe(-10.53); // −(0 product + 10.53 plFee)
    expect(cents(s1.legs)).toBe(0);
  });

  // bankCrLeg outputAmount null-fallback (L316) + owedChf regular null-fallbacks (L352 x2): a regular sell reaching
  // seq2/seq3 with outputAmount == null (→ seq1 skipped by the outputAmount gate) AND amountInChf == null AND
  // totalFeeAmountChf == null → owedChf = (0) − (0) = 0; bankCrLeg outputAmount = 0 → native −0, CHF −0 (CHF mark 1).
  it('defaults null outputAmount/amountInChf/totalFeeAmountChf to 0 in seq2/seq3 (L316, L352)', async () => {
    mockBatch([
      buyFiat({
        id: 29,
        amountInChf: null, // → owedChf amountInChf ?? 0 (L352)
        totalFeeAmountChf: null, // → owedChf totalFeeAmountChf ?? 0 (L352)
        outputAmount: null, // → seq1 skipped + bankCrLeg outputAmount ?? 0 (L316)
        outputReferenceAmount: 0,
        outputAsset: { name: 'CHF' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'CHF',
          bank: { asset: { id: CHF_BANK_ASSET_ID } },
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();

    expect(seq(1)).toBeUndefined(); // outputAmount null → seq1 gate skips it
    const s2 = seq(2);
    expect(leg(s2, 'LIABILITY/buyFiat-owed').amountChf).toBe(0); // (0) − (0)
    expect(leg(s2, 'TRANSIT/payout/CHF').amountChf).toBe(-0);
    const s3 = seq(3);
    expect(leg(s3, 'TRANSIT/payout/CHF').amountChf).toBe(0);
    const bankLeg = leg(s3, 'Bank/CHF');
    expect(bankLeg.amount).toBe(-0); // −(outputAmount ?? 0) = −0
    expect(bankLeg.amountChf).toBe(-0); // −(mark 1 × 0) = −0
    expect(bankLeg.needsMark).toBe(false); // CHF mark present → marked
  });

  // owedChf paymentLink outputAmount null-fallback (L351): a paymentLink row reaching seq2 with outputAmount == null
  // → owedChf = (0) × rate = 0. seq1 is skipped (outputAmount gate); seq2 transmits paymentLink 0 / TRANSIT −0.
  it('defaults a null outputAmount to 0 in the paymentLink owedChf (L351)', async () => {
    seq0PaymentLinkChf = -100; // opening present (irrelevant: seq1 skipped by the outputAmount gate)
    mockBatch([
      buyFiat({
        id: 30,
        amountInChf: 100,
        totalFeeAmountChf: 0,
        outputReferenceAmount: 100,
        outputAmount: null, // → owedChf (outputAmount ?? 0) × rate = 0
        outputAsset: { name: 'CHF' },
        cryptoInput: { id: 10, updated: new Date('2026-06-04T00:00:00Z'), paymentLinkPayment: { id: 1 } },
        fiatOutput: { isTransmittedDate: FRI, currency: 'CHF' } as any,
      }),
    ]);
    await consumer.process();

    expect(seq(1)).toBeUndefined(); // outputAmount null → §4.7b seq1 gate skips it
    const s2 = seq(2);
    expect(leg(s2, 'LIABILITY/paymentLink').amountChf).toBe(0); // (outputAmount ?? 0) × rate = 0
    expect(leg(s2, 'TRANSIT/payout/CHF').amountChf).toBe(-0);
    expect(cents(s2.legs)).toBe(0);
  });

  // outputCurrency fallback chain (L371): outputAsset undefined → uses fiatOutput.currency. EUR fiatOutput with no
  // outputAsset → the seq2 transit account is TRANSIT/payout/EUR (proves fiatOutput.currency, not the CHF default).
  it('uses fiatOutput.currency for outputCurrency when outputAsset is undefined (L371 second arm)', async () => {
    mockBatch([
      buyFiat({
        id: 31,
        amountInChf: 1000,
        totalFeeAmountChf: 10,
        outputAmount: 990,
        outputReferenceAmount: 990,
        outputAsset: undefined, // → fall through to fiatOutput.currency
        fiatOutput: { isTransmittedDate: FRI, currency: 'EUR' } as any,
      }),
    ]);
    await consumer.process();

    const s2 = seq(2);
    expect(leg(s2, 'TRANSIT/payout/EUR')).toBeDefined(); // outputCurrency = fiatOutput.currency = 'EUR'
    expect(leg(s2, 'TRANSIT/payout/EUR').amountChf).toBe(-990); // −owedChf (1000 − 10)
    expect(leg(s2, 'LIABILITY/buyFiat-owed').amountChf).toBe(990);
  });

  // outputCurrency fallback chain (L371): outputAsset undefined AND fiatOutput.currency undefined → final CHF default.
  // The seq2 transit account is TRANSIT/payout/CHF (proves the CHF tail of `?? bf.fiatOutput?.currency ?? CHF`).
  it('defaults outputCurrency to CHF when both outputAsset and fiatOutput.currency are undefined (L371 CHF tail)', async () => {
    mockBatch([
      buyFiat({
        id: 32,
        amountInChf: 1000,
        totalFeeAmountChf: 10,
        outputAmount: 990,
        outputReferenceAmount: 990,
        outputAsset: undefined, // → fiatOutput.currency
        fiatOutput: { isTransmittedDate: FRI } as any, // currency undefined → CHF
      }),
    ]);
    await consumer.process();

    const s2 = seq(2);
    expect(leg(s2, 'TRANSIT/payout/CHF')).toBeDefined(); // both undefined → CHF
    expect(leg(s2, 'TRANSIT/payout/CHF').amountChf).toBe(-990);
    expect(leg(s2, 'LIABILITY/buyFiat-owed').amountChf).toBe(990);
  });

  // paymentLinkOpeningChf null-cryptoInput guard (L424): a paymentLink row whose cryptoInput.id is null → the opening
  // gate returns undefined at the FIRST guard (no findOne lookup) → seq1 gate-blocked, book() returns false, nothing
  // booked. Distinct from the missing-seq0 test (id 5), which DOES reach findOne (cryptoInput.id set).
  it('gate-blocks the paymentLink seq1 when cryptoInput.id is null (L424 guard, no findOne lookup)', async () => {
    seq0PaymentLinkChf = -1000; // would satisfy the gate IF findOne were reached — but the null-id guard returns first
    const findOneSpy = jest.spyOn(ledgerTxRepo, 'findOne');
    mockBatch([
      buyFiat({
        id: 33,
        amountInChf: 1000,
        totalFeeAmountChf: 20,
        outputReferenceAmount: 950,
        outputAmount: 940,
        outputAsset: { name: 'CHF' },
        cryptoInput: { id: undefined, updated: new Date('2026-06-04T00:00:00Z'), paymentLinkPayment: { id: 1 } },
      }),
    ]);
    await consumer.process();

    expect(seq(1)).toBeUndefined(); // null cryptoInput.id → opening undefined → seq1 gate-blocked
    expect(findOneSpy).not.toHaveBeenCalled(); // the L424 guard short-circuits BEFORE the seq0 findOne lookup
  });

  // assetAccount not-found throw (L452): a regular sell reaching seq3 whose bank.asset.id resolves but
  // findByAssetId returns undefined → `throw ... CoA bootstrap missing`. Caught by processForward → seq3 absent,
  // watermark unchanged. seq1/seq2 (which precede the throw) ARE booked. Distinct from the bank.asset-missing throw
  // (id 20, L313): here the asset IS present, only the ledger account lookup fails.
  it('throws from assetAccount when findByAssetId returns undefined for a present bank asset (L452)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(accountService, 'findByAssetId').mockResolvedValue(null); // CoA bootstrap missing for the bank asset
    mockBatch([
      buyFiat({
        id: 34,
        amountInChf: 1000,
        totalFeeAmountChf: 10,
        outputAmount: 990,
        outputReferenceAmount: 990,
        outputAsset: { name: 'CHF' },
        fiatOutput: {
          isTransmittedDate: FRI,
          currency: 'CHF',
          bank: { asset: { id: 777 } }, // asset present (no L313 throw) but findByAssetId → null → L452 throw
          bankTx: { bookingDate: SUN },
        } as any,
      }),
    ]);
    await consumer.process();

    expect(seq(1)).toBeDefined(); // booked before the seq3 assetAccount throw
    expect(seq(2)).toBeDefined();
    expect(seq(3)).toBeUndefined(); // assetAccount threw → seq3 never booked
    expect(setSpy).not.toHaveBeenCalled(); // failure-isolation: watermark NOT advanced
  });
});
