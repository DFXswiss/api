import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { ExchangeTx, ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { Repository } from 'typeorm';
import { AccountType } from '../../../entities/ledger-account.entity';
import { LedgerLegRepository } from '../../../repositories/ledger-leg.repository';
import { BankTxConsumer } from '../../consumers/bank-tx.consumer';
import { BuyFiatConsumer } from '../../consumers/buy-fiat.consumer';
import { CryptoInputConsumer } from '../../consumers/crypto-input.consumer';
import { ExchangeTxConsumer } from '../../consumers/exchange-tx.consumer';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { InMemoryLedger } from './in-memory-ledger';

// asset ids of the seeded ASSET accounts (synthetic, structurally equal — no real customer/account data)
const ZCHF_WALLET = 200;
const CHF_BANK = 401;
const EUR_BANK = 402;
const SCRYPT_EUR = 50;
const SCRYPT_CHF = 51;
const SCRYPT_USDT = 60;

const FRI = new Date('2026-06-05T00:00:00Z'); // transmission (isTransmittedDate)
const SUN = new Date('2026-06-07T00:00:00Z'); // bank booking (Class-1 hold)
const SETTLED = new Date('2026-06-04T00:00:00Z');

/**
 * §10.2 Integrationstests = the synthetic evidence-week, run against the REAL booking+account services over a
 * shared in-memory ledger (InMemoryLedger). Unlike the unit consumer specs (which mock the booking service), this
 * proves that the received/owed/TRANSIT/SUSPENSE liabilities net to 0 ACROSS consumers — the Class-1/2/4
 * elimination thesis of Issue #385 — and that the single per-tx invariant Σ amountChfCents = 0 holds over
 * everything. All amounts are synthetic/scaled structural ratios (Minor R1-4); no real PRD tripel, no real IBAN.
 */
describe('Ledger evidence-week integration (§10.2)', () => {
  let ledger: InMemoryLedger;
  let markService: LedgerMarkService;

  // ZCHF mark ≈ 1, CHF bank = 1, EUR bank = 0.95, Scrypt assets (EUR 0.95 / CHF 1 / USDT 0.9)
  const markMap = new Map([
    [ZCHF_WALLET, [{ created: new Date('2026-01-01'), priceChf: 1 }]],
    [CHF_BANK, [{ created: new Date('2026-01-01'), priceChf: 1 }]],
    [EUR_BANK, [{ created: new Date('2026-01-01'), priceChf: 0.95 }]],
    [SCRYPT_EUR, [{ created: new Date('2026-01-01'), priceChf: 0.95 }]],
    [SCRYPT_CHF, [{ created: new Date('2026-01-01'), priceChf: 1 }]],
    [SCRYPT_USDT, [{ created: new Date('2026-01-01'), priceChf: 0.9 }]],
  ]);

  beforeEach(() => {
    new ConfigService(); // sets the Config singleton the booking service + consumers read (§11.2)

    ledger = new InMemoryLedger();
    // CoA bootstrap stand-in: ASSET accounts (by assetId) + the up-front non-ASSET accounts (§3.2/§3.4)
    ledger.seedAsset('Ethereum/ZCHF', 'ZCHF', ZCHF_WALLET);
    ledger.seedAsset('Maerki/CHF', 'CHF', CHF_BANK);
    ledger.seedAsset('Olkypay/EUR', 'EUR', EUR_BANK);
    ledger.seedAsset('Scrypt/EUR', 'EUR', SCRYPT_EUR);
    ledger.seedAsset('Scrypt/CHF', 'CHF', SCRYPT_CHF);
    ledger.seedAsset('Scrypt/USDT', 'USDT', SCRYPT_USDT);
    ledger.seed('ROUNDING', AccountType.ROUNDING, 'CHF');
    ledger.seed('EQUITY/opening-balance', AccountType.EQUITY, 'CHF');

    markService = createMock<LedgerMarkService>();
    jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(markMap));
  });

  // --- FIXTURE FACTORIES (synthetic, structurally equal) --- //

  function settingService(): SettingService {
    const s = createMock<SettingService>();
    jest.spyOn(s, 'getObj').mockResolvedValue(undefined); // fresh watermark (cutover-only default already past)
    jest.spyOn(s, 'set').mockResolvedValue();
    return s;
  }

  function cryptoInput(values: Partial<CryptoInput>): CryptoInput {
    return Object.assign(new CryptoInput(), {
      id: 1,
      updated: SETTLED,
      status: PayInStatus.FORWARD_CONFIRMED,
      amount: 15000,
      asset: { id: ZCHF_WALLET, uniqueName: 'Ethereum/ZCHF' },
      ...values,
    });
  }

  function buyFiat(values: Partial<BuyFiat>): BuyFiat {
    return Object.assign(new BuyFiat(), {
      id: 1,
      updated: SETTLED,
      cryptoInput: { id: 10, updated: SETTLED },
      outputAsset: { name: 'CHF' },
      ...values,
    });
  }

  function bankTx(values: Partial<BankTx>): BankTx {
    return Object.assign(new BankTx(), {
      id: 1,
      created: new Date('2026-06-01T00:00:00Z'),
      bookingDate: new Date('2026-06-01T00:00:00Z'),
      creditDebitIndicator: BankTxIndicator.CREDIT,
      currency: 'EUR',
      ...values,
    });
  }

  function exchangeTx(values: Partial<ExchangeTx>): ExchangeTx {
    return Object.assign(new ExchangeTx(), {
      id: 1,
      created: SETTLED,
      externalCreated: SETTLED,
      exchange: ExchangeName.SCRYPT,
      status: 'ok',
      ...values,
    });
  }

  // wires a CryptoInput consumer against the shared ledger
  function cryptoInputConsumer(rows: CryptoInput[]): CryptoInputConsumer {
    const repo = createMock<Repository<CryptoInput>>();
    jest.spyOn(repo, 'find').mockResolvedValue(rows);
    return new CryptoInputConsumer(settingService(), ledger.bookingService, ledger.accountService, markService, repo);
  }

  // wires a BuyFiat consumer against the shared ledger (its gate reads the in-memory LedgerTx store)
  function buyFiatConsumer(rows: BuyFiat[]): BuyFiatConsumer {
    const repo = createMock<Repository<BuyFiat>>();
    jest.spyOn(repo, 'find').mockResolvedValue(rows);
    return new BuyFiatConsumer(
      settingService(),
      ledger.bookingService,
      ledger.accountService,
      markService,
      repo,
      ledger.ledgerTxRepository(),
    );
  }

  // wires a BankTx consumer against the shared ledger; the Bank repo resolves the iban→asset lookup
  function bankTxConsumer(rows: BankTx[], banks: Bank[] = []): BankTxConsumer {
    const bankTxRepo = createMock<Repository<BankTx>>();
    jest.spyOn(bankTxRepo, 'find').mockResolvedValue(rows);
    const bankRepo = createMock<Repository<Bank>>();
    jest
      .spyOn(bankRepo, 'findOne')
      .mockImplementation(({ where }: any) => Promise.resolve(banks.find((b) => b.iban === where.iban) ?? null));
    return new BankTxConsumer(
      settingService(),
      ledger.bookingService,
      ledger.accountService,
      markService,
      bankTxRepo,
      bankRepo,
    );
  }

  // wires an ExchangeTx consumer against the shared ledger (+ the shared leg store for the sweep match)
  function exchangeTxConsumer(rows: ExchangeTx[]): ExchangeTxConsumer {
    const exchangeTxRepo = createMock<Repository<ExchangeTx>>();
    jest.spyOn(exchangeTxRepo, 'find').mockImplementation(({ where, select }: any) => {
      if (select) return Promise.resolve([]); // fill-index existing-trades lookup (select-only query)
      // honour the consumer's settled filter (status='ok' eliminates Class 2) — pending rows are not returned
      return Promise.resolve(rows.filter((r) => where?.status == null || r.status === where.status));
    });
    const bankTxRepo = createMock<Repository<BankTx>>();
    jest.spyOn(bankTxRepo, 'find').mockResolvedValue([]); // no bank route match → wallet/SUSPENSE branch

    const legRepo = createMock<LedgerLegRepository>();
    jest.spyOn(legRepo, 'find').mockImplementation(({ where }: any) => {
      // §4.3b Raiffeisen sweep match: open Dr posts on the named SUSPENSE account within the date window
      const accountId = where?.account?.id;
      return Promise.resolve(
        ledger.legs.filter(
          (l) => l.account?.id === accountId && l.amount > 0 && l.account?.type === AccountType.SUSPENSE,
        ) as any,
      );
    });

    return new ExchangeTxConsumer(
      settingService(),
      ledger.bookingService,
      ledger.accountService,
      markService,
      exchangeTxRepo,
      bankTxRepo,
      legRepo,
    );
  }

  // --- 1. CLASS-1 LIABILITY-HOLD (the 14'980.12 headline, single bf, Fri-transmit → Sun-booking) --- //

  it('Class-1: a single buy_fiat holds its liability until the Sunday booking (15000/148.50/14851.50)', async () => {
    // crypto_input opens received −15000 (single booker, §4.1); buy_fiat does the fee/owed/TRANSIT/bank chain.
    // the crypto_input eager-loads buyFiat with amountInChf (the received-Cr base anchor, §4.4)
    const ci = cryptoInput({ id: 10, amount: 15000, buyFiat: { id: 1, amountInChf: 15000 } as any });
    const bf = buyFiat({
      id: 1,
      amountInChf: 15000,
      totalFeeAmountChf: 148.5,
      outputAmount: 14851.5,
      outputReferenceAmount: 14851.5,
      outputAsset: { name: 'CHF' } as any,
      cryptoInput: { id: 10, updated: SETTLED } as any,
      fiatOutput: {
        isTransmittedDate: FRI,
        currency: 'CHF',
        bank: { asset: { id: CHF_BANK } },
        bankTx: { bookingDate: SUN },
      } as any,
    });

    await cryptoInputConsumer([ci]).process();
    await buyFiatConsumer([bf]).process();

    // received: opened −15000 (crypto_input seq0), debited +15000 (buy_fiat seq1 fee+reclass) → closes to 0
    expect(ledger.chfBalance('LIABILITY/buyFiat-received')).toBe(0);
    // owed: opened −14851.50 (seq1 reclass), transmitted +14851.50 (seq2) → closes to 0
    expect(ledger.chfBalance('LIABILITY/buyFiat-owed')).toBe(0);

    // the value stays in TRANSIT between Friday and Sunday — closed only by the Sunday bank booking
    const transitTx = ledger.txs.find((t) => t.sourceType === 'buy_fiat' && t.seq === 2);
    expect(transitTx.bookingDate).toEqual(FRI);
    const bookedTx = ledger.txs.find((t) => t.sourceType === 'buy_fiat' && t.seq === 3);
    expect(bookedTx.bookingDate).toEqual(SUN); // the single 14851.50 bank debit happens at bookingDate, NOT Friday
    expect(ledger.chfBalance('TRANSIT/payout/CHF')).toBe(0); // nets after the Sunday booking

    // the bank is debited GENAU once by exactly the output amount
    expect(ledger.chfBalance('Maerki/CHF')).toBe(-14851.5);
    expect(ledger.nativeBalance('Maerki/CHF')).toBe(-14851.5);

    // exactly one received-credit (no double input leg, single-booker §4.1)
    const receivedCredits = ledger.legs.filter((l) => l.account?.name === 'LIABILITY/buyFiat-received' && l.amount < 0);
    expect(receivedCredits).toHaveLength(1);
    expect(receivedCredits[0].amountChf).toBe(-15000);

    // INCOME/fee-buyFiat realized exactly the 148.50 fee
    expect(ledger.chfBalance('INCOME/fee-buyFiat')).toBe(-148.5);
    expect(ledger.everyTxBalances()).toBe(true);
  });

  // --- 2. SEPARATE SYNTHETIC N:1 DEFENSIVE (decoupled from the headline, §1.13 / Major R10-1) --- //

  it('N:1-defensive: three buy_fiats → one fiat_output → ASSET/bank debited once per row (Σ = fiat_output.amount)', async () => {
    const sharedOutput = {
      isTransmittedDate: FRI,
      currency: 'CHF',
      bank: { asset: { id: CHF_BANK } },
      bankTx: { bookingDate: SUN },
      amount: 1800, // fiat_output.amount = Σ bf.outputAmount = 1000 + 500 + 300
    };
    const makeCi = (id: number, amount: number, bfId: number) =>
      cryptoInput({ id, amount, buyFiat: { id: bfId, amountInChf: amount } as any });
    const makeBf = (id: number, ciId: number, out: number) =>
      buyFiat({
        id,
        amountInChf: out,
        totalFeeAmountChf: 0,
        outputAmount: out,
        outputReferenceAmount: out,
        outputAsset: { name: 'CHF' } as any,
        cryptoInput: { id: ciId, updated: SETTLED } as any,
        fiatOutput: sharedOutput as any,
      });

    await cryptoInputConsumer([makeCi(11, 1000, 101), makeCi(12, 500, 102), makeCi(13, 300, 103)]).process();
    await buyFiatConsumer([makeBf(101, 11, 1000), makeBf(102, 12, 500), makeBf(103, 13, 300)]).process();

    // three seq3 bank legs, each its own outputAmount; ASSET/bank debited by exactly fiat_output.amount = 1800
    const bankLegs = ledger.legs.filter((l) => l.account?.name === 'Maerki/CHF');
    expect(bankLegs).toHaveLength(3);
    expect(bankLegs.map((l) => l.amountChf).sort((a, b) => a - b)).toEqual([-1000, -500, -300].sort((a, b) => a - b));
    expect(ledger.chfBalance('Maerki/CHF')).toBe(-1800); // NOT the full bank_tx once, NOT just one of the three

    // all three owed close to 0, TRANSIT closes to 0, every received closes to 0
    expect(ledger.chfBalance('LIABILITY/buyFiat-owed')).toBe(0);
    expect(ledger.chfBalance('TRANSIT/payout/CHF')).toBe(0);
    expect(ledger.chfBalance('LIABILITY/buyFiat-received')).toBe(0);

    // each buy_fiat carries its own (sourceType, sourceId, seq) idempotency key (no UNIQUE collision)
    for (const id of [101, 102, 103]) {
      expect(ledger.txs.some((t) => t.sourceType === 'buy_fiat' && t.sourceId === `${id}` && t.seq === 3)).toBe(true);
    }
    expect(ledger.everyTxBalances()).toBe(true);
  });

  // --- 3. CLASS-2 DOUBLE-COUNTING WINDOW (pending not booked, then ok → exactly one booking) --- //

  it('Class-2: a Scrypt deposit pending is not booked, then ok books once → TRANSIT closes, no imbalance', async () => {
    // pending: status != 'ok' → the consumer's settled filter excludes it (no booking)
    const pending = exchangeTx({
      id: 1,
      type: ExchangeTxType.DEPOSIT,
      status: 'pending',
      currency: 'EUR',
      amount: 1000,
      txId: '0xdeposit',
    });
    await exchangeTxConsumer([pending]).process();
    expect(ledger.txs.filter((t) => t.sourceType === 'exchange_tx')).toHaveLength(0);

    // ok: wallet→exchange deposit (txId present, no bank route) → TRANSIT/wallet↔Scrypt/EUR
    const settled = exchangeTx({
      id: 1,
      type: ExchangeTxType.DEPOSIT,
      status: 'ok',
      currency: 'EUR',
      amount: 1000,
      amountChf: 950,
      txId: '0xdeposit',
    });
    // the wallet-side withdrawal closing the same TRANSIT route (mirror leg → nets to 0)
    const walletWithdrawal = exchangeTx({
      id: 2,
      type: ExchangeTxType.WITHDRAWAL,
      status: 'ok',
      currency: 'EUR',
      amount: 1000,
      amountChf: 950,
      txId: '0xwithdraw',
    });
    await exchangeTxConsumer([settled, walletWithdrawal]).process();

    // GENAU one booking of the deposit (no double count from the pending phase)
    expect(ledger.txs.filter((t) => t.sourceType === 'exchange_tx' && t.sourceId === '1')).toHaveLength(1);
    // the deposit + withdrawal net the same TRANSIT/wallet↔Scrypt/EUR route to 0 (no journal imbalance)
    expect(ledger.chfBalance('TRANSIT/wallet↔Scrypt/EUR')).toBe(0);
    expect(ledger.everyTxBalances()).toBe(true);
  });

  // --- 5. CLASS-4 SWEEP → SUSPENSE (generic untracked-bank rule, no bank-name hardcode) --- //

  it('Class-4: an untracked-bank credit lands in SUSPENSE, the exchange sweep pushes it back down', async () => {
    // generic untracked-bank rule (no Bank row matches the iban) → SUSPENSE/untracked-bank-{name}-{ccy} (§4.2/§1.6).
    // The credit's value lands in SUSPENSE as the native EUR custody amount (the SUSPENSE account has no asset row,
    // so the consumer cannot mark-value it — the CHF side flows to fx-revaluation; the unambiguous Class-4 evidence
    // is the NATIVE SUSPENSE balance + the fully-counted received liability). The exchange deposit then sweeps it.
    const credit = bankTx({
      id: 1,
      type: BankTxType.BUY_CRYPTO,
      creditDebitIndicator: BankTxIndicator.CREDIT,
      currency: 'EUR',
      amount: 1000,
      bankName: 'Raiffeisen',
      accountIban: 'SYNTH-UNTRACKED-IBAN',
      buyCrypto: { amountInChf: 950 } as any,
    });
    await bankTxConsumer([credit]).process();

    const suspenseName = 'SUSPENSE/untracked-bank-Raiffeisen-EUR';
    expect(ledger.hasAccount(suspenseName)).toBe(true);
    expect(ledger.nativeBalance(suspenseName)).toBe(1000); // Dr SUSPENSE native EUR (value entered, awaiting sweep)
    expect(ledger.chfBalance('LIABILITY/buyCrypto-received')).toBe(-950); // Cr received fully counted (Class-4 fix)

    // the Scrypt-EUR deposit sweep matches the open SUSPENSE post by amount/date → drives SUSPENSE native back to 0
    const sweep = exchangeTx({
      id: 1,
      type: ExchangeTxType.DEPOSIT,
      status: 'ok',
      exchange: ExchangeName.SCRYPT,
      currency: 'EUR',
      amount: 1000,
      amountChf: 950,
      externalCreated: new Date('2026-06-02T00:00:00Z'),
    });
    await exchangeTxConsumer([sweep]).process();

    expect(ledger.nativeBalance(suspenseName)).toBe(0); // swept down, not monotonically growing (Class-4 thesis)
    expect(ledger.chfBalance('Scrypt/EUR')).toBe(950); // value arrived in the exchange custody account
    expect(ledger.everyTxBalances()).toBe(true);
  });

  // --- 6. TRADE VIA symbol/side --- //

  it('Trade via symbol/side: a Scrypt buy books base/quote legs + the persisted spread, Σ CHF = 0', async () => {
    // Scrypt trade: feeAmountChf IS the market spread (§4.3 variant i) → one spread leg, quote leg as plug
    const trade = exchangeTx({
      id: 1,
      type: ExchangeTxType.TRADE,
      status: 'ok',
      symbol: 'USDT/CHF',
      side: 'buy',
      amount: 1000, // base USDT
      amountChf: 900, // base CHF value (mark 0.9)
      cost: 905, // quote CHF spent
      feeAmountChf: 5, // market spread
      order: 'order-1',
    });
    await exchangeTxConsumer([trade]).process();

    const tradeTx = ledger.txs.find((t) => t.sourceType === 'ExchangeTrade');
    expect(tradeTx).toBeDefined();
    // base leg (USDT bought) and quote leg (CHF spent) both booked
    expect(ledger.nativeBalance('Scrypt/USDT')).toBe(1000); // base +amount
    expect(ledger.chfBalance('EXPENSE/spread-Scrypt')).toBe(5); // the persisted market spread as one leg
    expect(ledger.everyTxBalances()).toBe(true);

    // null-symbol trade → SUSPENSE rest (not silently dropped)
    const unattributable = exchangeTx({ id: 2, type: ExchangeTxType.TRADE, status: 'ok', amountChf: 100 });
    await exchangeTxConsumer([unattributable]).process();
    expect(ledger.hasAccount('SUSPENSE/Scrypt-trade-unattributed')).toBe(true);
  });

  // --- 8. BALANCE INVARIANT OVER EVERYTHING --- //

  it('Balance invariant: every booked tx of the whole evidence week closes to amountChfSum === 0', async () => {
    // run a heterogeneous mix through the shared ledger, then assert the single per-tx invariant over ALL of it
    const ci = cryptoInput({ id: 10, amount: 15000, buyFiat: { id: 1, amountInChf: 15000 } as any });
    const bf = buyFiat({
      id: 1,
      amountInChf: 15000,
      totalFeeAmountChf: 148.5,
      outputAmount: 14851.5,
      outputReferenceAmount: 14851.5,
      cryptoInput: { id: 10, updated: SETTLED } as any,
      fiatOutput: {
        isTransmittedDate: FRI,
        currency: 'CHF',
        bank: { asset: { id: CHF_BANK } },
        bankTx: { bookingDate: SUN },
      } as any,
    });
    const eurCredit = bankTx({
      id: 1,
      type: BankTxType.BANK_TX_RETURN,
      creditDebitIndicator: BankTxIndicator.CREDIT,
      currency: 'EUR',
      amount: 100,
      accountIban: 'SYNTH-EUR-IBAN',
    });
    const eurBank = Object.assign(new Bank(), {
      iban: 'SYNTH-EUR-IBAN',
      currency: 'EUR',
      name: 'Olkypay',
      asset: { id: EUR_BANK } as any,
    });
    const trade = exchangeTx({
      id: 1,
      type: ExchangeTxType.TRADE,
      status: 'ok',
      symbol: 'USDT/CHF',
      side: 'buy',
      amount: 1000,
      amountChf: 900,
      cost: 905,
      feeAmountChf: 5,
      order: 'order-1',
    });

    await cryptoInputConsumer([ci]).process();
    await buyFiatConsumer([bf]).process();
    await bankTxConsumer([eurCredit], [eurBank]).process();
    await exchangeTxConsumer([trade]).process();

    // the ONLY per-tx invariant (CHF cross-asset) holds over every tx of the week (Major R9-2)
    expect(ledger.txs.length).toBeGreaterThan(0);
    expect(ledger.everyTxBalances()).toBe(true);
    for (const tx of ledger.txs) {
      expect(typeof tx.amountChfSum).toBe('number'); // integer type, never a bigint string (Blocker R1-4)
      expect(tx.amountChfSum).toBe(0);
    }

    // native balances are deliberately NOT 0 for value-boundary txs — they are the custody balances (§7 feed)
    expect(ledger.nativeBalance('Maerki/CHF')).not.toBe(0);
    expect(ledger.nativeBalance('Scrypt/USDT')).not.toBe(0);
  });
});
