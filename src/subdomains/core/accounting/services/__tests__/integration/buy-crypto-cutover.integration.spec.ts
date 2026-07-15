import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { Repository } from 'typeorm';
import { AccountType } from '../../../entities/ledger-account.entity';
import { BuyCryptoConsumer } from '../../consumers/buy-crypto.consumer';
import { InMemoryLedger } from './in-memory-ledger';

/**
 * §10.2 integration — the MAJOR cutover double-book finding for Card (Checkout) buy_crypto inputs, run against the
 * REAL booking + account services over a shared in-memory ledger (InMemoryLedger). Two Card rows straddle the cutover:
 *  (A) a row OPEN at the cutover: its card-currency GROSS is already in the aggregate ASSET opening (openAssets books
 *      liquidityBalance.total, which carries the Checkout.com collateral feed of auto-captured card charges) AND the
 *      cutover booked its per-row buyCrypto-received opening (Major B1), so the forward consumer SKIPS seq0 — re-booking
 *      it would re-debit the gross on Checkout/{ccy} a SECOND time (permanent phantom, the pre-fix bug) — and books
 *      only seq1, which closes LIABILITY/buyCrypto-received against the cutover opening to 0;
 *  (B) a row already SETTLED at the cutover whose `updated` moves post-cutover (chargeback/mail flag): its value is
 *      already in the aggregate opening (openAssets) → the consumer must re-book NOTHING (no phantom Checkout asset /
 *      phantom owed).
 * Two more rows are OWED-straddling (outputAmount set, not complete at the snapshot → per-row cutover owed opening
 * `<logId>:buy_crypto-owed:<id>`, §6.1) and complete post-cutover — the consumer must book NEITHER seq0 NOR seq1
 * (the payout_order consumer closes owed against the opening anchor):
 *  (C) bank-funded: pre-fix the content-change scan threw forever (receivedOpened never true → permanent wedge);
 *  (D) Card-funded: pre-fix seq0+seq1 booked ON TOP of the owed opening (double count).
 * All amounts synthetic; no real customer/account/IBAN (public repo).
 */
describe('Ledger buy_crypto cutover Card double-book (§10.2, MAJOR)', () => {
  const SNAPSHOT = new Date('2026-06-07T22:00:00Z'); // cutover snapshot (= ledgerCutoverSnapshotDate)
  const PRE_CUTOVER = new Date('2026-05-15T00:00:00Z'); // Card completion BEFORE the snapshot (Scenario B)
  const POST_CUTOVER = new Date('2026-06-20T00:00:00Z'); // completion / flag change AFTER the cutover

  let ledger: InMemoryLedger;
  let settingService: SettingService; // the consumer's SettingService mock (watermark-write assertions read its spy)

  beforeEach(() => {
    new ConfigService(); // sets the Config singleton the booking service + consumer read (§11.2)

    ledger = new InMemoryLedger();
    // CoA bootstrap stand-in: the Card custody account + the up-front non-ASSET accounts (§3.2/§3.4)
    ledger.seed('Checkout/EUR', AccountType.ASSET, 'EUR');
    ledger.seed('ROUNDING', AccountType.ROUNDING, 'CHF');
    ledger.seed('EQUITY/opening-balance', AccountType.EQUITY, 'CHF');
  });

  function buyCrypto(values: Partial<BuyCrypto>): BuyCrypto {
    return Object.assign(new BuyCrypto(), {
      id: 1,
      created: new Date('2026-05-10T00:00:00Z'),
      isComplete: false,
      checkoutTx: { currency: 'EUR' } as any, // Card input
      inputReferenceAmount: 1050, // card-currency gross — the F2 custody native (seq0 booking requires it)
      ...values,
    });
  }

  // a SettingService modelling a completed cutover: ledgerCutoverLogId + the pinned snapshot date are set, and the
  // buy_crypto watermark's lastProcessedId is already PAST the straddling row id (late-settling → the forward id-scan
  // skips it) with lastReversalScan = the snapshot (the content-change scan re-selects it via updated > lastReversalScan).
  function cutoverSettingService(lastProcessedId: number): SettingService {
    const s = createMock<SettingService>();
    jest.spyOn(s, 'get').mockImplementation((key: string) => {
      if (key === 'ledgerCutoverLogId') return Promise.resolve('1557344' as any);
      if (key === 'ledgerCutoverSnapshotDate') return Promise.resolve(SNAPSHOT.toISOString() as any);
      return Promise.resolve(undefined as any);
    });
    jest.spyOn(s, 'getObj').mockResolvedValue({ lastProcessedId, lastReversalScan: SNAPSHOT.toISOString() } as any);
    jest.spyOn(s, 'set').mockResolvedValue();
    return s;
  }

  // wires a BuyCryptoConsumer against the shared ledger; the row is reached ONLY by the §6.3 content-change scan
  // (forward id-scan returns [] since id <= lastProcessedId; the content-change scan returns the row via where.updated)
  function consumer(row: BuyCrypto, lastProcessedId: number): BuyCryptoConsumer {
    const repo = createMock<Repository<BuyCrypto>>();
    jest
      .spyOn(repo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [row] : []));
    settingService = cutoverSettingService(lastProcessedId);
    return new BuyCryptoConsumer(
      settingService,
      ledger.bookingService,
      ledger.accountService,
      repo,
      ledger.ledgerTxRepository(),
    );
  }

  // books the §6.1 per-row cutover owed opening (Cr LIABILITY/buyCrypto-owed −chf / Dr EQUITY +chf) the cutover
  // wrote for an owed-straddling row (outputAmount set, not complete at the snapshot); logId matches the mock above
  async function bookOwedOpening(rowId: number, chf: number): Promise<void> {
    const owed = await ledger.accountService.findOrCreate('LIABILITY/buyCrypto-owed', AccountType.LIABILITY, 'CHF');
    const equity = await ledger.accountService.findOrCreate('EQUITY/opening-balance', AccountType.EQUITY, 'CHF');
    await ledger.bookingService.bookTx({
      sourceType: 'cutover',
      sourceId: `1557344:buy_crypto-owed:${rowId}`,
      seq: 0,
      bookingDate: SNAPSHOT,
      valueDate: SNAPSHOT,
      description: `Opening buyCrypto-owed from open buy_crypto #${rowId}`,
      legs: [
        { account: owed, amount: -chf, priceChf: 1, amountChf: -chf },
        { account: equity, amount: chf, priceChf: 1, amountChf: chf },
      ],
    });
  }

  // books the §6.1 per-row cutover received opening (Cr LIABILITY/buyCrypto-received −chf / Dr EQUITY +chf) the cutover
  // wrote for an OPEN-at-cutover row (Major B1: Card rows are now included). The completion seq1 closes received against
  // this opening; the forward Card seq0 is skipped because this marker exists.
  async function bookReceivedOpening(rowId: number, chf: number): Promise<void> {
    const received = await ledger.accountService.findOrCreate(
      'LIABILITY/buyCrypto-received',
      AccountType.LIABILITY,
      'CHF',
    );
    const equity = await ledger.accountService.findOrCreate('EQUITY/opening-balance', AccountType.EQUITY, 'CHF');
    await ledger.bookingService.bookTx({
      sourceType: 'cutover',
      sourceId: `1557344:buy_crypto:${rowId}`,
      seq: 0,
      bookingDate: SNAPSHOT,
      valueDate: SNAPSHOT,
      description: `Opening buyCrypto-received from open buy_crypto #${rowId}`,
      legs: [
        { account: received, amount: -chf, priceChf: 1, amountChf: -chf },
        { account: equity, amount: chf, priceChf: 1, amountChf: chf },
      ],
    });
  }

  it('Scenario A: an open Card row completing after the cutover skips seq0 (marker present) and books only seq1 → received closes to 0, Checkout not re-debited', async () => {
    // Major B1: the cutover DID open a per-row buyCrypto-received for this OPEN-at-cutover Card row (bookReceivedOpening
    // below) and its card gross is already in the aggregate ASSET opening (openAssets → the Checkout.com collateral
    // feed; out of this consumer test's scope). It completes post-cutover, so the content-change scan SKIPS seq0 — the
    // marker exists, re-booking would re-debit the gross on Checkout/EUR a second time (the pre-fix phantom) — and books
    // only seq1 (fee/reclass), which closes received against the cutover opening.
    await bookReceivedOpening(70, 1000); // §6.1 per-row cutover received opening for the open Card row (−1000)

    const row = buyCrypto({
      id: 70,
      amountInChf: 1000,
      totalFeeAmountChf: 10,
      isComplete: true,
      outputDate: POST_CUTOVER, // completed AFTER the snapshot → completion booked post-cutover
      updated: POST_CUTOVER,
    });

    await consumer(row, 100).process();

    // seq0 SKIPPED (cutover received marker present → the forward card seq0 would double-debit the gross); seq1 booked
    expect(ledger.txs.some((t) => t.sourceType === 'buy_crypto' && t.sourceId === '70' && t.seq === 0)).toBe(false);
    expect(ledger.txs.some((t) => t.sourceType === 'buy_crypto' && t.sourceId === '70' && t.seq === 1)).toBe(true);
    // received: opened −1000 by the cutover, debited +10 fee + +990 reclass (seq1) → closes to 0 (NOT −1000)
    expect(ledger.chfBalance('LIABILITY/buyCrypto-received')).toBe(0);
    // owed = −(amountInChf − fee)
    expect(ledger.chfBalance('LIABILITY/buyCrypto-owed')).toBe(-990);
    // Checkout/EUR is NOT touched by the consumer: the card gross is already carried by the aggregate ASSET opening
    // (the collateral feed contains it). Pre-fix the forward seq0 re-debited +1000 here → permanent phantom.
    expect(ledger.chfBalance('Checkout/EUR')).toBe(0);
    expect(ledger.everyTxBalances()).toBe(true);
  });

  it('Scenario B: a Card row settled before the cutover, updated after it, is NOT re-booked (no phantom)', async () => {
    // settled pre-cutover (outputDate ≤ snapshot) → value already in the aggregate opening; a post-cutover flag bumps
    // `updated` → the content-change scan re-selects it, but the Card gate must skip BOTH seq0 and seq1 (no double-book).
    const row = buyCrypto({
      id: 71,
      amountInChf: 1000,
      totalFeeAmountChf: 10,
      isComplete: true,
      outputDate: PRE_CUTOVER, // settled BEFORE the snapshot → covered by the aggregate opening
      updated: POST_CUTOVER, // chargeback/mail flag set post-cutover → re-selected by the content-change scan
    });

    await consumer(row, 100).process();

    expect(ledger.txs.filter((t) => t.sourceType === 'buy_crypto' && t.sourceId === '71')).toHaveLength(0);
    // no phantom: received untouched (0), Card custody never debited, owed never created
    expect(ledger.chfBalance('LIABILITY/buyCrypto-received')).toBe(0);
    expect(ledger.chfBalance('Checkout/EUR')).toBe(0);
    expect(ledger.hasAccount('LIABILITY/buyCrypto-owed')).toBe(false);
    expect(ledger.everyTxBalances()).toBe(true);
  });

  it('Scenario C: an owed-straddling bank-funded row completing after the cutover books nothing and advances (no wedge)', async () => {
    // owed-straddling (§6.1): outputAmount was set at the snapshot → the cutover booked the per-row owed opening; the
    // payout_order consumer closes owed against that anchor. This consumer must book NEITHER seq0 NOR seq1. Pre-fix,
    // the content-change scan threw forever for this row (receivedOpened never true, preCutoverSettled false because
    // outputDate is post-cutover) — booking nothing is NOT enough evidence, the cursor MUST also advance past the row.
    await bookOwedOpening(72, 990);
    const row = buyCrypto({
      id: 72,
      amountInChf: 1000,
      totalFeeAmountChf: 10,
      outputAmount: 0.5, // set pre-cutover → owed-straddling
      isComplete: true,
      outputDate: POST_CUTOVER, // completed AFTER the snapshot
      updated: POST_CUTOVER,
      checkoutTx: null, // bank-funded, not Card
      bankTx: { id: 600 } as any,
    });

    await consumer(row, 100).process();

    // nothing booked by this consumer: no seq0/seq1 (the owed opening is the only tx touching this row)
    expect(ledger.txs.filter((t) => t.sourceType === 'buy_crypto' && t.sourceId === '72')).toHaveLength(0);
    expect(ledger.chfBalance('LIABILITY/buyCrypto-owed')).toBe(-990); // owed still equals the opening value
    // the content-change cursor ADVANCED past the row (pre-fix wedge: the scan threw → cursor stayed at the snapshot)
    const wmWrites = (settingService.set as jest.Mock).mock.calls.filter((c) => c[0] === 'ledgerWatermark.buy_crypto');
    expect(wmWrites).toHaveLength(1);
    expect(JSON.parse(wmWrites[0][1]).lastReversalScan).toBe(POST_CUTOVER.toISOString());
    expect(JSON.parse(wmWrites[0][1]).lastReversalScanId).toBe(72);
    expect(ledger.everyTxBalances()).toBe(true);
  });

  it('Scenario D: an owed-straddling Card row completing after the cutover is NOT double-counted (no seq0/seq1)', async () => {
    // Card variant of Scenario C: pre-fix, receivedOpened returned true via the Card branch → seq0+seq1 booked IN
    // ADDITION to the cutover owed opening → owed doubled to −1980 and Checkout/EUR carried a phantom +1000.
    await bookOwedOpening(73, 990);
    const row = buyCrypto({
      id: 73,
      amountInChf: 1000,
      totalFeeAmountChf: 10,
      outputAmount: 0.5, // set pre-cutover → owed-straddling
      isComplete: true,
      outputDate: POST_CUTOVER,
      updated: POST_CUTOVER, // checkoutTx { currency: 'EUR' } from the helper → Card-funded
    });

    await consumer(row, 100).process();

    expect(ledger.txs.filter((t) => t.sourceType === 'buy_crypto' && t.sourceId === '73')).toHaveLength(0);
    expect(ledger.chfBalance('Checkout/EUR')).toBe(0); // Card custody never debited
    expect(ledger.chfBalance('LIABILITY/buyCrypto-owed')).toBe(-990); // ONLY the opening value, no double count
    expect(ledger.hasAccount('LIABILITY/buyCrypto-received')).toBe(false); // received untouched (never created)
    expect(ledger.everyTxBalances()).toBe(true);
  });
});
