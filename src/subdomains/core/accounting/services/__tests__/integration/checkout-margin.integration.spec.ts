import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { Repository } from 'typeorm';
import { AccountType } from '../../../entities/ledger-account.entity';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { BankTxConsumer } from '../../consumers/bank-tx.consumer';
import { BuyCryptoConsumer } from '../../consumers/buy-crypto.consumer';
import { InMemoryLedger } from './in-memory-ledger';

/**
 * §10.2 integration — the F2 Checkout/{ccy} native convention across BOTH bookers of the account, run against the
 * REAL booking + account services over a shared in-memory ledger (InMemoryLedger):
 *  (a) the Card input seq0 (BuyCryptoConsumer): Dr Checkout/EUR native = card-currency GROSS (inputReferenceAmount
 *      1000 EUR), amountChf = gross CHF (950 → implied rate 0.95);
 *  (b) the CHECKOUT_LTD settlement (BankTxConsumer): Cr Checkout/EUR native GROSS = net 990 + feeNative 10 (ladder 2,
 *      chargeAmount persisted in the settlement currency), amountChf = −(netChf 940.5 + feeChf 9.5) = −950.
 * With native gross on every leg the account closes to 0 in BOTH units (native 1000 − 1000, CHF 950 − 950), so the
 * mark-to-market diff (mark × native − chf) is 0 BY CONSTRUCTION — nothing to flush, NO phantom fxPnl: the acquirer
 * fee lives exactly once, on EXPENSE/acquirer-fee. Pre-fix the settlement booked native NET (−990) against gross CHF
 * → a fee-sized native/CHF mismatch the M2M job flushed as a phantom INCOME/EXPENSE fx-revaluation posting (fee
 * counted twice in the margin report). All amounts synthetic; no real customer/account/IBAN (public repo).
 */
describe('Ledger Checkout margin (F2 card-currency gross convention, MAJOR)', () => {
  const CREATED = new Date('2026-06-01T00:00:00Z');
  const SETTLED = new Date('2026-06-03T00:00:00Z');

  let ledger: InMemoryLedger;

  beforeEach(() => {
    new ConfigService(); // sets the Config singleton the booking service + consumers read (§11.2)

    ledger = new InMemoryLedger();
    // CoA bootstrap stand-in: the Card custody + the tracked EUR bank ASSET accounts (§3.2/§3.4)
    ledger.seedAsset('Checkout/EUR', 'EUR', 270);
    ledger.seedAsset('Olkypay/EUR', 'EUR', 269);
    ledger.seed('ROUNDING', AccountType.ROUNDING, 'CHF');
  });

  // no cutover ran (forward-only booking); watermarks start fresh; set() is a no-op spy
  function freshSettingService(): SettingService {
    const s = createMock<SettingService>();
    jest.spyOn(s, 'get').mockResolvedValue(undefined);
    jest.spyOn(s, 'getObj').mockResolvedValue(undefined);
    jest.spyOn(s, 'set').mockResolvedValue();
    return s;
  }

  // forward id-scan returns the rows; the §4.12 content-change scan (where.updated) returns []
  function repoWith<T>(rows: T[]): Repository<T> {
    const repo = createMock<Repository<T>>();
    jest
      .spyOn(repo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [] : rows));
    return repo;
  }

  function buyCryptoConsumer(row: BuyCrypto): BuyCryptoConsumer {
    return new BuyCryptoConsumer(
      freshSettingService(),
      ledger.bookingService,
      ledger.accountService,
      repoWith([row]),
      ledger.ledgerTxRepository(),
    );
  }

  function bankTxConsumer(row: BankTx): BankTxConsumer {
    // tracked EUR bank (asset 269) resolved by iban; the same-currency mark lookup is never needed (tracked)
    const bankRepo = createMock<Repository<Bank>>();
    jest
      .spyOn(bankRepo, 'findOne')
      .mockImplementation((opts: any) =>
        Promise.resolve(
          opts?.where?.iban === 'EUR-IBAN'
            ? Object.assign(new Bank(), { name: 'Olkypay', currency: 'EUR', asset: { id: 269 } })
            : null,
        ),
      );

    // EUR mark 0.95 — the SAME mark values the net settlement leg and (via ladder 3, unused here) a CHF-only fee
    const markService = createMock<LedgerMarkService>();
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[269, [{ created: new Date('2026-01-01'), priceChf: 0.95 }]]])));

    const bankTxReturnRepo = createMock<Repository<BankTxReturn>>();
    jest.spyOn(bankTxReturnRepo, 'findOne').mockResolvedValue(null);
    const bankTxRepeatRepo = createMock<Repository<BankTxRepeat>>();
    jest.spyOn(bankTxRepeatRepo, 'findOne').mockResolvedValue(null);

    return new BankTxConsumer(
      freshSettingService(),
      ledger.bookingService,
      ledger.accountService,
      markService,
      repoWith([row]),
      bankRepo,
      ledger.ledgerTxRepository(),
      bankTxReturnRepo,
      bankTxRepeatRepo,
    );
  }

  it('closes Checkout/EUR to 0 in native AND CHF across seq0 + settlement → no phantom fxPnl for the acquirer fee', async () => {
    // (a) Card input seq0: 1000 EUR gross charged on the card, 950 CHF gross → implied rate 0.95
    const card = Object.assign(new BuyCrypto(), {
      id: 200,
      created: CREATED,
      updated: CREATED,
      isComplete: false, // input only — the completion seq1 is irrelevant to the custody account
      checkoutTx: { currency: 'EUR' } as any,
      inputReferenceAmount: 1000, // card-currency gross (F2 custody native)
      amountInChf: 950, // gross CHF
    });
    await buyCryptoConsumer(card).process();

    // (b) CHECKOUT_LTD settlement: net 990 EUR to the bank, acquirer fee 10 EUR (chargeAmount, settlement currency,
    // ladder 2) / 9.5 CHF (chargeAmountChf) → custody Cr native gross −(990 + 10), CHF −(940.5 + 9.5)
    const settlement = Object.assign(new BankTx(), {
      id: 300,
      created: CREATED,
      updated: SETTLED,
      bookingDate: SETTLED,
      type: BankTxType.CHECKOUT_LTD,
      creditDebitIndicator: BankTxIndicator.CREDIT,
      accountIban: 'EUR-IBAN',
      currency: 'EUR',
      amount: 990,
      chargeAmount: 10,
      chargeCurrency: 'EUR',
      chargeAmountChf: 9.5,
    });
    await bankTxConsumer(settlement).process();

    // both bookings committed
    expect(ledger.txs.some((t) => t.sourceType === 'buy_crypto' && t.sourceId === '200' && t.seq === 0)).toBe(true);
    expect(ledger.txs.some((t) => t.sourceType === 'bank_tx' && t.sourceId === '300' && t.seq === 0)).toBe(true);

    // the F2 convention closes the custody account in BOTH units: native 1000 − (990 + 10) = 0 AND CHF 950 − 950 = 0.
    // With a balanced native+CHF pair the mark-to-market diff (mark × native − chf) is 0 by construction → nothing to
    // flush → NO phantom fxPnl; the acquirer fee lives exactly once, on EXPENSE/acquirer-fee.
    expect(ledger.nativeBalance('Checkout/EUR')).toBe(0);
    expect(ledger.chfBalance('Checkout/EUR')).toBe(0);
    expect(ledger.chfBalance('EXPENSE/acquirer-fee')).toBe(9.5);

    // settlement side effects stay mark-consistent: bank net 990 EUR / 940.5 CHF; the Card CHF sits on `received`
    expect(ledger.nativeBalance('Olkypay/EUR')).toBe(990);
    expect(ledger.chfBalance('Olkypay/EUR')).toBe(940.5);
    expect(ledger.chfBalance('LIABILITY/buyCrypto-received')).toBe(-950);

    expect(ledger.everyTxBalances()).toBe(true);
  });
});
