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
 *  (A) a row OPEN at the cutover: the per-row cutover opening is EXCLUDED for Card, so the forward consumer's seq0 IS
 *      the card opening — after completion seq0 + seq1 close LIABILITY/buyCrypto-received to 0 (pre-fix: −amountInChf);
 *  (B) a row already SETTLED at the cutover whose `updated` moves post-cutover (chargeback/mail flag): its value is
 *      already in the aggregate opening (openAssets) → the consumer must re-book NOTHING (no phantom Checkout asset /
 *      phantom owed).
 * All amounts synthetic; no real customer/account/IBAN (public repo).
 */
describe('Ledger buy_crypto cutover Card double-book (§10.2, MAJOR)', () => {
  const SNAPSHOT = new Date('2026-06-07T22:00:00Z'); // cutover snapshot (= ledgerCutoverSnapshotDate)
  const PRE_CUTOVER = new Date('2026-05-15T00:00:00Z'); // Card completion BEFORE the snapshot (Scenario B)
  const POST_CUTOVER = new Date('2026-06-20T00:00:00Z'); // completion / flag change AFTER the cutover

  let ledger: InMemoryLedger;

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
    return new BuyCryptoConsumer(
      cutoverSettingService(lastProcessedId),
      ledger.bookingService,
      ledger.accountService,
      repo,
      ledger.ledgerTxRepository(),
    );
  }

  it('Scenario A: an open Card row completing after the cutover books seq0+seq1 → received closes to 0', async () => {
    // the cutover did NOT open a per-row received for this Card row (Card excluded); it completes post-cutover, so the
    // content-change scan books the fresh seq0 (the card opening) + seq1 (fee/reclass) → received nets to 0.
    const row = buyCrypto({
      id: 70,
      amountInChf: 1000,
      totalFeeAmountChf: 10,
      isComplete: true,
      outputDate: POST_CUTOVER, // completed AFTER the snapshot → NOT covered by the aggregate opening
      updated: POST_CUTOVER,
    });

    await consumer(row, 100).process();

    // seq0 (card opening) + seq1 (completion) both booked
    expect(ledger.txs.some((t) => t.sourceType === 'buy_crypto' && t.sourceId === '70' && t.seq === 0)).toBe(true);
    expect(ledger.txs.some((t) => t.sourceType === 'buy_crypto' && t.sourceId === '70' && t.seq === 1)).toBe(true);
    // received: opened −1000 (seq0), debited +10 fee + +990 reclass (seq1) → closes to 0 (NOT −1000, the pre-fix bug)
    expect(ledger.chfBalance('LIABILITY/buyCrypto-received')).toBe(0);
    // owed = −(amountInChf − fee); the Card custody is debited exactly once by amountInChf
    expect(ledger.chfBalance('LIABILITY/buyCrypto-owed')).toBe(-990);
    expect(ledger.chfBalance('Checkout/EUR')).toBe(1000);
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
});
