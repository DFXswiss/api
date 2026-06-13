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
  let activeKeys: Set<string>; // `${sourceId}:${seq}` with an active booking — backs hasActiveTxAt (per-seq, R3)
  let gateOpen: boolean; // simulates a seq0 crypto_input ledger_tx existing

  beforeEach(async () => {
    booked = [];
    nextSeqValue = 0;
    activeKeys = new Set<string>();
    gateOpen = true;
    accounts = new Map([['Checkout/EUR', account('Checkout/EUR', AccountType.ASSET, 'EUR')]]);

    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    settingService = createMock<SettingService>();
    buyCryptoRepo = createMock<Repository<BuyCrypto>>();
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

    // gate lookup: countBy returns 1 when the gate is open (seq0 crypto_input / cutover marker exists). For the
    // G-b cutover path the consumer also resolves the snapshot logId prefix from ledgerCutoverLogId (Blocker R4-2):
    // a gate-open run models a completed cutover (logId set) so the `${logId}:buy_crypto:${id}` marker is resolvable.
    jest.spyOn(ledgerTxRepo, 'countBy').mockImplementation(() => Promise.resolve(gateOpen ? 1 : 0));

    jest.spyOn(settingService, 'getObj').mockResolvedValue(undefined);
    jest
      .spyOn(settingService, 'get')
      .mockImplementation((key: string) =>
        Promise.resolve(key === 'ledgerCutoverLogId' && gateOpen ? '1557344' : undefined),
      );
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
  // forward id-scan returns the rows; the §4.12 content-change scan (where has `updated`, not `id`) returns [] —
  // its late-settling/cutover-straddling coverage is asserted in the integration spec (no double-book here)
  const mockBatch = (rows: BuyCrypto[]) =>
    jest
      .spyOn(buyCryptoRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [] : rows));
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

  // §5.1 additive null-strategy (line 149): a completion with totalFeeAmountChf null → fee 0, reclass = amountInChf.
  // The fee leg is +0 and owed closes at the full amountInChf (no fee carved out).
  it('treats a null totalFeeAmountChf as fee 0 in the completion (additive null-strategy)', async () => {
    mockBatch([buyCrypto({ id: 33, amountInChf: 15000, totalFeeAmountChf: null, isComplete: true })]);
    await consumer.process();

    const tx = seq(1);
    expect(tx).toBeDefined();
    expect(leg(tx, 'INCOME/fee-buyCrypto').amountChf).toBe(-0); // fee 0 → INCOME credit −0
    expect(leg(tx, 'LIABILITY/buyCrypto-owed').amountChf).toBe(-15000); // owed = −(amountInChf − 0)
    const receivedSum = tx.legs
      .filter((l) => l.account.name === 'LIABILITY/buyCrypto-received')
      .reduce((s, l) => s + (l.amountChf ?? 0), 0);
    expect(receivedSum).toBe(15000); // closes the −15000 received to 0
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

  it('is idempotent: skips seq1 when an active booking already exists at seq1 (re-run)', async () => {
    activeKeys.add('8:0').add('8:1'); // seq0 + completion seq1 of buy_crypto 8 already booked
    mockBatch([buyCrypto({ id: 8, amountInChf: 1000, totalFeeAmountChf: 10, isComplete: true })]);
    await consumer.process();
    expect(seq(1)).toBeUndefined();
  });

  // R3 — content-change reversal of seq0 BEFORE the completion is booked must NOT strand seq1: the reversal/re-book
  // live in the correction range (≥1_000_000), seq1 is still free, and the completion books + closes received to 0.
  it('books the completion (seq1) even after a seq0 content-change reversal (no stranded later seq, R3)', async () => {
    // model the post-reversal ledger state: seq0 reversed+rebooked into the correction range; seq1 NOT yet booked.
    // hasActiveTxAt(seq0)=true (a live re-book exists), hasActiveTxAt(seq1)=false (never booked) — the exact state the
    // old `nextSeq>seq` gate mis-read as "seq1 booked" because MAX(seq) had jumped into the correction range.
    activeKeys.add('10:0');
    nextSeqValue = 1_000_002; // MAX(seq) jumped past 1 after the reversal/re-book — the trap the old gate fell into
    mockBatch([buyCrypto({ id: 10, amountInChf: 1000, totalFeeAmountChf: 10, isComplete: true })]);

    await consumer.process();

    const tx = seq(1);
    expect(tx).toBeDefined(); // completion booked despite MAX(seq) being far above 1
    const receivedSum = tx.legs
      .filter((l) => l.account.name === 'LIABILITY/buyCrypto-received')
      .reduce((s, l) => s + (l.amountChf ?? 0), 0);
    expect(receivedSum).toBe(1000); // +10 fee + 990 reclass → closes the −1000 received to 0
    expect(cents(tx.legs)).toBe(0);
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

  // --- ERROR / GATE BRANCHES --- //

  // §4.6 failure-isolation: a Card input whose Checkout account is missing throws in bookCardInput → break, watermark
  // not advanced (retry next run)
  it('stops the batch and leaves the watermark when the Checkout account is missing (failure-isolation)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    accounts.delete('Checkout/EUR'); // findByName('Checkout/EUR') → undefined → throw in checkoutAccount
    mockBatch([buyCrypto({ id: 20, amountInChf: 1000, checkoutTx: { currency: 'EUR' } as any })]);
    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled(); // throw → break before advancing
  });

  // §4.7 G-a gate: a non-Card buy_crypto whose crypto_input seq0 ledger_tx exists (countBy>0) opens the completion
  it('books the completion via the G-a gate (crypto_input seq0 ledger_tx exists)', async () => {
    // non-Card (no checkoutTx) but the crypto_input seq0 ledger_tx exists → receivedOpened true via G-a (countBy>0)
    mockBatch([
      buyCrypto({
        id: 21,
        amountInChf: 1000,
        totalFeeAmountChf: 10,
        isComplete: true,
        cryptoInput: { id: 555 } as any, // G-a: countBy(crypto_input, 555, seq0) > 0 (gateOpen=true default)
      }),
    ]);
    await consumer.process();

    const tx = seq(1);
    expect(tx).toBeDefined(); // G-a opened received → completion books
    const receivedSum = tx.legs
      .filter((l) => l.account.name === 'LIABILITY/buyCrypto-received')
      .reduce((s, l) => s + (l.amountChf ?? 0), 0);
    expect(receivedSum).toBe(1000); // closes received to 0
  });

  // §4.7 receivedOpened: cutover not run (ledgerCutoverLogId unset) AND no G-a → gate closed → completion skipped
  it('skips the completion when the cutover has not run and no G-a opening exists', async () => {
    gateOpen = false; // countBy → 0 AND ledgerCutoverLogId → undefined
    mockBatch([
      buyCrypto({
        id: 22,
        amountInChf: 1000,
        totalFeeAmountChf: 10,
        isComplete: true,
        cryptoInput: { id: 556 } as any, // G-a countBy → 0; cutoverReceivedSourceId → undefined (no logId)
      }),
    ]);
    await consumer.process();

    expect(seq(1)).toBeUndefined(); // gate closed → no completion
  });

  // §4.6 bookCompletion guard: an isComplete row with null amountInChf throws → failure-isolation
  it('throws (failure-isolation) on a complete buy_crypto with null amountInChf', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    // Card input so seq0 is skipped (amountInChf null → buildCardInputSeq0 returns undefined, no seq0), but isComplete
    // → book() reaches bookCompletion which throws on the null amountInChf.
    mockBatch([buyCrypto({ id: 23, amountInChf: null, isComplete: true, checkoutTx: { currency: 'EUR' } as any })]);
    await consumer.process();

    expect(booked).toHaveLength(0); // seq0 skipped (no amountInChf), completion throws
    expect(setSpy).not.toHaveBeenCalled(); // throw → watermark not advanced
  });

  // --- §4.12 / §6.3 CONTENT-CHANGE SCAN --- //

  // the content-change scan reverses+rebooks a Card-input seq0 and then books any newly-settled completion
  it('runs the content-change scan: reverses+rebooks the Card seq0 then books the completion', async () => {
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    const changed = buyCrypto({
      id: 30,
      amountInChf: 1000,
      totalFeeAmountChf: 10,
      isComplete: true,
      checkoutTx: { currency: 'EUR' } as any, // Card input → buildCardInputSeq0 resolves → reverseAndRebookIfChanged
    });
    // forward id-scan empty; content-change scan (where.updated) returns the changed Card row
    jest
      .spyOn(buyCryptoRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [changed] : []));

    await consumer.process();

    expect(rebookSpy).toHaveBeenCalledTimes(1); // the Card seq0 reverse-and-rebook ran
    expect(rebookSpy.mock.calls[0][0].sourceId).toBe('30');
    // and the idempotent forward book() then appended the completion seq1
    expect(booked.some((b) => b.seq === 1 && b.sourceId === '30')).toBe(true);
  });

  // a content-change row that is a NON-Card input has no seq0 here → buildCardInputSeq0 undefined → no reversal,
  // but the idempotent book() still appends the completion
  it('content-change scan: a non-Card row triggers no seq0 reversal but still books its completion', async () => {
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(false);
    const changed = buyCrypto({
      id: 31,
      amountInChf: 1000,
      totalFeeAmountChf: 10,
      isComplete: true,
      cryptoInput: { id: 557 } as any, // non-Card → no seq0 here, G-a gate open (gateOpen default)
    });
    jest
      .spyOn(buyCryptoRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [changed] : []));

    await consumer.process();

    expect(rebookSpy).not.toHaveBeenCalled(); // non-Card → no seq0 reverse
    expect(booked.some((b) => b.seq === 1 && b.sourceId === '31')).toBe(true); // completion still booked
  });
});
