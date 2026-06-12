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

    // seq1 realizes BOTH DFX fee shares (product fee 20 + merchant plFee = 950 − 940 = 10, CHF-valued) as INCOME
    const s1 = seq(1);
    const feeIncome = leg(s1, 'INCOME/fee-paymentLink');
    expect(feeIncome).toBeDefined();
    expect(feeIncome.amountChf).toBeLessThan(0); // negative = INCOME credit

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
});
