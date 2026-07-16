import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { ExchangeTx } from 'src/integration/exchange/entities/exchange-tx.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { TradingOrder } from 'src/subdomains/core/trading/entities/trading-order.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayoutOrder } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { Repository } from 'typeorm';
import { AccountType } from '../../../entities/ledger-account.entity';
import { BuyCryptoConsumer } from '../../consumers/buy-crypto.consumer';
import { BuyFiatConsumer } from '../../consumers/buy-fiat.consumer';
import { CryptoInputConsumer } from '../../consumers/crypto-input.consumer';
import { LedgerBootstrapService } from '../../ledger-bootstrap.service';
import { LedgerCutoverService } from '../../ledger-cutover.service';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { InMemoryLedger } from './in-memory-ledger';

/**
 * §10.2 integration — the MAJOR cutover double-book finding for CRYPTO-funded (swap/sell) buy_crypto/buy_fiat inputs,
 * run against the REAL LedgerCutoverService + CryptoInputConsumer + BuyCrypto/BuyFiatConsumer over a shared in-memory
 * ledger (InMemoryLedger). The whole chain — cutover opening → forward crypto_input seq0 → completion — actually books,
 * so LIABILITY/{bucket}-received provably nets across the boundary.
 *
 * The window (G-a exclusivity): a buy_crypto/buy_fiat priced at AML (amountInChf set on isConfirmed) but still OPEN at
 * the snapshot, funded by a crypto_input NOT yet settled (status ∉ CryptoInputSettledStatus). The forward crypto_input
 * seq0 credits ${bucket}-received once it settles post-cutover; the cutover per-row opening would credit it a SECOND
 * time (disjoint sourceId namespaces → no UNIQUE backstop), leaving a permanent −amountInChf phantom on received after
 * the completion debits once. The fix skips the per-row opening for an unsettled input; a settled input keeps it (its
 * seq0 is suppressed as covered-by-cutover). All amounts synthetic; no real customer/account/IBAN (public repo).
 */
describe('Ledger crypto_input-funded cutover double-book (§10.2, MAJOR — G-a exclusivity)', () => {
  const SNAPSHOT = new Date('2026-06-07T22:00:00Z');
  const POST_CUTOVER = new Date('2026-06-20T00:00:00Z');
  const LOG_ID = 1557344;
  const WALLET = 100; // ZCHF wallet assetId
  const CHF_BANK = 101; // CHF payout-bank assetId

  let ledger: InMemoryLedger;
  let store: Map<string, string>;
  let settingService: SettingService;
  let markService: LedgerMarkService;

  beforeEach(() => {
    new ConfigService(); // sets the Config singleton the booking service + consumers read (§11.2)

    ledger = new InMemoryLedger();
    ledger.seedAsset('Ethereum/ZCHF', 'ZCHF', WALLET);
    ledger.seedAsset('Maerki/CHF', 'CHF', CHF_BANK);
    ledger.seed('ROUNDING', AccountType.ROUNDING, 'CHF');
    ledger.seed('EQUITY/opening-balance', AccountType.EQUITY, 'CHF');

    // one stateful setting store shared by the cutover AND the consumers: the cutover writes the boundary/watermark/
    // logId/snapshotDate; the consumers read them back (the §4.7 G-a/G-b gate + §6.3 covered-by-cutover guard).
    store = new Map<string, string>();
    settingService = createMock<SettingService>();
    jest.spyOn(settingService, 'get').mockImplementation((key: string) => Promise.resolve(store.get(key) as any));
    jest.spyOn(settingService, 'getObj').mockImplementation((key: string, defaultValue?: any) => {
      const raw = store.get(key);
      return Promise.resolve(raw != null ? JSON.parse(raw) : defaultValue);
    });
    jest.spyOn(settingService, 'set').mockImplementation((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    });

    markService = createMock<LedgerMarkService>();
    jest.spyOn(markService, 'preload').mockResolvedValue(
      new LedgerMarkCache(
        new Map([
          [WALLET, [{ created: new Date('2026-01-01'), priceChf: 1 }]],
          [CHF_BANK, [{ created: new Date('2026-01-01'), priceChf: 1 }]],
        ]),
      ),
    );
  });

  // --- FIXTURES --- //

  function snapshotLog(): Log {
    return Object.assign(new Log(), {
      id: LOG_ID,
      created: SNAPSHOT,
      valid: true,
      message: JSON.stringify({ assets: {}, tradings: {}, balancesByFinancialType: {}, balancesTotal: {} }),
    });
  }

  // a repo whose createQueryBuilder returns a MAX(id) boundary of `max` (getRawMany = [] for the openHoleIds path)
  function repoWith<T>(rows: T[], max = 0): Repository<T> {
    const repo = createMock<Repository<T>>();
    jest.spyOn(repo, 'find').mockResolvedValue(rows as any);
    const qb: any = {
      select: () => qb,
      where: () => qb,
      andWhere: () => qb,
      getRawOne: () => Promise.resolve({ max }),
      getRawMany: () => Promise.resolve([]),
    };
    jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb);
    return repo;
  }

  // returns `row` for the cutover's received query (where.outputAmount = IsNull()), [] for the owed query
  function receivedOnly<T>(row: T | undefined, cryptoBoundary = 0): Repository<T> {
    const repo = repoWith<T>([], 0);
    jest
      .spyOn(repo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.outputAmount && row ? [row] : []));
    void cryptoBoundary;
    return repo;
  }

  /**
   * builds + runs the REAL cutover over the shared ledger for one open buy_crypto/buy_fiat received row, with the
   * crypto_input boundary pinned to `cryptoBoundary` (0 → an unsettled funding input is post-boundary → its forward
   * seq0 books; ≥ the input id → it is covered-by-cutover → its seq0 is suppressed).
   */
  async function runCutover(opts: {
    buyCrypto?: BuyCrypto;
    buyFiat?: BuyFiat;
    cryptoBoundary?: number;
  }): Promise<void> {
    const logService = createMock<LogService>();
    jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog()]);
    jest.spyOn(logService, 'getLog').mockResolvedValue(snapshotLog());

    const bootstrapService = createMock<LedgerBootstrapService>();
    jest.spyOn(bootstrapService, 'bootstrap').mockResolvedValue();

    const service = new LedgerCutoverService(
      settingService,
      logService,
      bootstrapService,
      ledger.bookingService,
      ledger.accountService,
      markService,
      repoWith<Asset>([]),
      receivedOnly<BuyFiat>(opts.buyFiat),
      receivedOnly<BuyCrypto>(opts.buyCrypto),
      repoWith<BankTx>([]),
      repoWith<Bank>([]),
      repoWith<BankTxReturn>([]),
      repoWith<BankTxRepeat>([]),
      repoWith<CryptoInput>([], opts.cryptoBoundary ?? 0),
      repoWith<ExchangeTx>([]),
      repoWith<PayoutOrder>([]),
      repoWith<LiquidityManagementOrder>([]),
      repoWith<TradingOrder>([]),
      repoWith<LiquidityOrder>([]),
      createMock<AssetService>(),
    );

    await service.run();
  }

  // runs the real CryptoInputConsumer over the shared ledger. `forward` = the row is in the forward id-batch (its seq0
  // books); otherwise it is reached only by the content-change scan (covered-by-cutover → seq0 suppressed).
  async function runCryptoInput(ci: CryptoInput, forward: boolean): Promise<void> {
    const repo = createMock<Repository<CryptoInput>>();
    jest
      .spyOn(repo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve((where?.updated != null) === !forward ? [ci] : []));
    await new CryptoInputConsumer(
      settingService,
      ledger.bookingService,
      ledger.accountService,
      markService,
      repo,
    ).process();
  }

  async function runBuyCrypto(bc: BuyCrypto): Promise<void> {
    const repo = createMock<Repository<BuyCrypto>>();
    jest
      .spyOn(repo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [] : [bc]));
    await new BuyCryptoConsumer(
      settingService,
      ledger.bookingService,
      ledger.accountService,
      repo,
      ledger.ledgerTxRepository(),
    ).process();
  }

  async function runBuyFiat(bf: BuyFiat): Promise<void> {
    const repo = createMock<Repository<BuyFiat>>();
    jest
      .spyOn(repo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [] : [bf]));
    await new BuyFiatConsumer(
      settingService,
      ledger.bookingService,
      ledger.accountService,
      markService,
      repo,
      ledger.ledgerTxRepository(),
    ).process();
  }

  // --- (a) UNSETTLED crypto_input at the cutover: NO per-row opening, forward seq0 is the sole opener --- //

  it('(a) buy_crypto with an UNSETTLED crypto_input: cutover skips the per-row opening; forward seq0 opens received; completion closes it to 0', async () => {
    // OPEN at the cutover (outputAmount null), priced (amountInChf 1000), funded by a crypto_input still ACKNOWLEDGED
    const openRow = Object.assign(new BuyCrypto(), {
      id: 90,
      created: new Date('2026-06-01T00:00:00Z'),
      isComplete: false,
      amountInChf: 1000,
      outputAmount: null,
      cryptoInput: { id: 900, status: PayInStatus.ACKNOWLEDGED },
    });

    await runCutover({ buyCrypto: openRow, cryptoBoundary: 0 });

    // the fix: NO per-row cutover received opening for the unsettled-input row
    expect(ledger.txs.some((t) => t.sourceType === 'cutover' && t.sourceId === `${LOG_ID}:buy_crypto:90`)).toBe(false);
    expect(ledger.chfBalance('LIABILITY/buyCrypto-received')).toBe(0); // untouched by the cutover (no credit leg)

    // post-cutover the crypto_input settles → its forward seq0 opens buyCrypto-received exactly once (−1000)
    const ci = Object.assign(new CryptoInput(), {
      id: 900,
      updated: POST_CUTOVER,
      status: PayInStatus.FORWARD_CONFIRMED,
      amount: 1000,
      asset: { id: WALLET, uniqueName: 'Ethereum/ZCHF' },
      buyCrypto: { amountInChf: 1000 },
    });
    await runCryptoInput(ci, true);

    const seq0s = ledger.txs.filter((t) => t.sourceType === 'crypto_input' && t.sourceId === '900' && t.seq === 0);
    expect(seq0s).toHaveLength(1); // seq0 booked ONCE (no double-open)
    expect(ledger.chfBalance('LIABILITY/buyCrypto-received')).toBe(-1000); // opened only by the forward seq0

    // completion post-cutover → G-a gate (the seq0 opened received) → seq1 closes received to 0
    const completeRow = Object.assign(new BuyCrypto(), {
      id: 90,
      created: new Date('2026-06-01T00:00:00Z'),
      isComplete: true,
      amountInChf: 1000,
      totalFeeAmountChf: 10,
      outputAmount: 0.5,
      outputDate: POST_CUTOVER,
      updated: POST_CUTOVER,
      cryptoInput: { id: 900 },
    });
    await runBuyCrypto(completeRow);

    expect(ledger.txs.some((t) => t.sourceType === 'buy_crypto' && t.sourceId === '90' && t.seq === 1)).toBe(true);
    expect(ledger.chfBalance('LIABILITY/buyCrypto-received')).toBe(0); // NOT −1000 (the pre-fix phantom)
    expect(ledger.chfBalance('LIABILITY/buyCrypto-owed')).toBe(-990); // −(amountInChf − fee)
    expect(ledger.nativeBalance('Ethereum/ZCHF')).toBe(1000); // wallet debited once by the seq0, never doubled
    expect(ledger.everyTxBalances()).toBe(true);
  });

  it('(a) buy_fiat with an UNSETTLED crypto_input: cutover skips the per-row opening; forward seq0 opens received; the sell chain closes received + owed to 0', async () => {
    const openRow = Object.assign(new BuyFiat(), {
      id: 80,
      created: new Date('2026-06-01T00:00:00Z'),
      isComplete: false,
      amountInChf: 15000,
      outputAmount: null,
      cryptoInput: { id: 800, status: PayInStatus.ACKNOWLEDGED },
    });

    await runCutover({ buyFiat: openRow, cryptoBoundary: 0 });

    expect(ledger.txs.some((t) => t.sourceType === 'cutover' && t.sourceId === `${LOG_ID}:buy_fiat:80`)).toBe(false);
    expect(ledger.chfBalance('LIABILITY/buyFiat-received')).toBe(0); // untouched by the cutover (no credit leg)

    const ci = Object.assign(new CryptoInput(), {
      id: 800,
      updated: POST_CUTOVER,
      status: PayInStatus.FORWARD_CONFIRMED,
      amount: 15000,
      asset: { id: WALLET, uniqueName: 'Ethereum/ZCHF' },
      buyFiat: { amountInChf: 15000 },
    });
    await runCryptoInput(ci, true);

    expect(
      ledger.txs.filter((t) => t.sourceType === 'crypto_input' && t.sourceId === '800' && t.seq === 0),
    ).toHaveLength(1);
    expect(ledger.chfBalance('LIABILITY/buyFiat-received')).toBe(-15000);

    // full regular-sell settlement post-cutover (CHF output): reclassification (seq1) + transmit (seq2) + booked (seq3)
    const completeRow = Object.assign(new BuyFiat(), {
      id: 80,
      created: new Date('2026-06-01T00:00:00Z'),
      updated: POST_CUTOVER,
      amountInChf: 15000,
      totalFeeAmountChf: 148.5,
      outputAmount: 14851.5,
      outputReferenceAmount: 14851.5,
      outputAsset: { name: 'CHF' },
      cryptoInput: { id: 800, updated: POST_CUTOVER },
      fiatOutput: {
        isTransmittedDate: POST_CUTOVER,
        currency: 'CHF',
        bank: { asset: { id: CHF_BANK } },
        bankTx: { bookingDate: POST_CUTOVER },
      },
    });
    await runBuyFiat(completeRow);

    expect(ledger.txs.some((t) => t.sourceType === 'buy_fiat' && t.sourceId === '80' && t.seq === 1)).toBe(true);
    expect(ledger.chfBalance('LIABILITY/buyFiat-received')).toBe(0); // closed by seq1 (NOT −15000)
    expect(ledger.chfBalance('LIABILITY/buyFiat-owed')).toBe(0); // reclassified then transmitted + booked
    expect(ledger.chfBalance('TRANSIT/payout/CHF')).toBe(0);
    expect(ledger.chfBalance('Maerki/CHF')).toBe(-14851.5);
    expect(ledger.everyTxBalances()).toBe(true);
  });

  // --- (b) SETTLED crypto_input at the cutover: per-row opening kept, forward seq0 suppressed (covered) --- //

  it('(b) buy_crypto with a SETTLED crypto_input: cutover opens the per-row received; forward seq0 is suppressed (covered); completion closes received to 0 via G-b', async () => {
    // funded by a crypto_input FORWARD_CONFIRMED at the snapshot → its value is in the aggregate ASSET opening; the
    // cutover opens the per-row buyCrypto-received (id 91), and the crypto_input boundary covers input id 910.
    const openRow = Object.assign(new BuyCrypto(), {
      id: 91,
      created: new Date('2026-06-01T00:00:00Z'),
      isComplete: false,
      amountInChf: 1000,
      outputAmount: null,
      cryptoInput: { id: 910, status: PayInStatus.FORWARD_CONFIRMED },
    });

    await runCutover({ buyCrypto: openRow, cryptoBoundary: 910 });

    // settled input → the per-row opening IS booked (−1000), the sole received opener
    expect(ledger.txs.some((t) => t.sourceType === 'cutover' && t.sourceId === `${LOG_ID}:buy_crypto:91`)).toBe(true);
    expect(ledger.chfBalance('LIABILITY/buyCrypto-received')).toBe(-1000);

    // the covered crypto_input is re-selected by the content-change scan (updated bump) but its seq0 is suppressed
    const ci = Object.assign(new CryptoInput(), {
      id: 910,
      updated: POST_CUTOVER,
      status: PayInStatus.FORWARD_CONFIRMED,
      amount: 1000,
      asset: { id: WALLET, uniqueName: 'Ethereum/ZCHF' },
      buyCrypto: { amountInChf: 1000 },
    });
    await runCryptoInput(ci, false);

    expect(ledger.txs.some((t) => t.sourceType === 'crypto_input' && t.sourceId === '910' && t.seq === 0)).toBe(false);
    expect(ledger.chfBalance('LIABILITY/buyCrypto-received')).toBe(-1000); // still ONLY the cutover opening (no double)

    // completion post-cutover → G-b gate (the cutover marker opened received) → seq1 closes received to 0
    const completeRow = Object.assign(new BuyCrypto(), {
      id: 91,
      created: new Date('2026-06-01T00:00:00Z'),
      isComplete: true,
      amountInChf: 1000,
      totalFeeAmountChf: 10,
      outputAmount: 0.5,
      outputDate: POST_CUTOVER,
      updated: POST_CUTOVER,
      cryptoInput: { id: 910 },
    });
    await runBuyCrypto(completeRow);

    expect(ledger.txs.some((t) => t.sourceType === 'buy_crypto' && t.sourceId === '91' && t.seq === 1)).toBe(true);
    expect(ledger.chfBalance('LIABILITY/buyCrypto-received')).toBe(0);
    expect(ledger.chfBalance('LIABILITY/buyCrypto-owed')).toBe(-990);
    expect(ledger.everyTxBalances()).toBe(true);
  });
});
