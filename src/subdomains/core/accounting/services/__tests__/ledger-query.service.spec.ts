import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { LiquidityBalance } from 'src/subdomains/core/liquidity-management/entities/liquidity-balance.entity';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { createCustomLedgerAccount } from '../../entities/__mocks__/ledger-account.entity.mock';
import { createCustomLedgerLeg } from '../../entities/__mocks__/ledger-leg.entity.mock';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerLeg } from '../../entities/ledger-leg.entity';
import { LedgerTx } from '../../entities/ledger-tx.entity';
import { LedgerAccountRepository } from '../../repositories/ledger-account.repository';
import { LedgerLegRepository } from '../../repositories/ledger-leg.repository';
import { LedgerQueryService } from '../ledger-query.service';
import { FeedStatus, LedgerReconciliationService } from '../ledger-reconciliation.service';

// holds the values returned by the chainable leg query-builder, keyed by a discriminator from the captured SQL
interface LegQbStub {
  balancesByAccount?: { accountId: number; native: string; chf: string }[];
  marginRows?: { bucket: string; type: AccountType; name: string; chf: string }[];
  suspenseLegs?: LedgerLeg[];
  detailLegs?: LedgerLeg[];
  detailTotal?: number;
  counterLegs?: LedgerLeg[];
  rawOne?: Record<string, { native?: string; chf?: string }>; // keyed by discriminator
}

describe('LedgerQueryService', () => {
  let service: LedgerQueryService;

  let ledgerAccountRepository: LedgerAccountRepository;
  let ledgerLegRepository: LedgerLegRepository;
  let reconciliationService: LedgerReconciliationService;
  let liquidityManagementBalanceService: LiquidityManagementBalanceService;
  let logService: LogService;

  let qbStub: LegQbStub;

  function assetAccount(id: number, assetId: number, name: string): LedgerAccount {
    return createCustomLedgerAccount({
      id,
      name,
      type: AccountType.ASSET,
      assetId,
      currency: 'EUR',
      asset: Object.assign(new Asset(), { id: assetId }),
    });
  }

  function feed(assetId: number, amount: number, updated: Date): LiquidityBalance {
    return Object.assign(new LiquidityBalance(), { asset: { id: assetId } as Asset, amount, updated });
  }

  function legTx(custom: Partial<LedgerTx>): LedgerTx {
    return Object.assign(new LedgerTx(), {
      id: 1,
      bookingDate: new Date('2026-06-07T00:00:00.000Z'),
      valueDate: new Date('2026-06-07T00:00:00.000Z'),
      sourceType: 'buy_fiat',
      sourceId: '1',
      seq: 0,
      ...custom,
    });
  }

  function makeLeg(custom: Partial<LedgerLeg>, account?: LedgerAccount, txCustom: Partial<LedgerTx> = {}): LedgerLeg {
    return createCustomLedgerLeg({
      id: 1,
      txId: 1,
      accountId: account?.id ?? 5,
      amount: 0,
      account,
      tx: legTx(txCustom),
      ...custom,
    });
  }

  // chainable query-builder stub: records select/where, resolves terminal methods by the captured expressions
  function legQb(): any {
    const qb: any = { _selects: [] as string[], _wheres: [] as string[] };
    const chain = () => qb;
    qb.innerJoin = chain;
    qb.innerJoinAndSelect = chain;
    qb.leftJoin = chain;
    qb.select = (expr: string) => {
      qb._selects.push(expr);
      return qb;
    };
    qb.addSelect = (expr: string) => {
      qb._selects.push(expr);
      return qb;
    };
    qb.where = (expr: string) => {
      qb._wheres.push(expr);
      return qb;
    };
    qb.andWhere = (expr: string) => {
      qb._wheres.push(expr);
      return qb;
    };
    qb.groupBy = chain;
    qb.addGroupBy = chain;
    qb.having = chain;
    qb.orderBy = chain;
    qb.addOrderBy = chain;
    qb.skip = chain;
    qb.take = chain;

    qb.getRawMany = () => {
      const selects = qb._selects.join(' ');
      // margin query selects account.type per row; the balances query does not
      if (selects.includes('account.type')) return Promise.resolve(qbStub.marginRows ?? []);
      return Promise.resolve(qbStub.balancesByAccount ?? []);
    };
    qb.getRawOne = () => Promise.resolve({ native: '0', chf: '0' });
    qb.getMany = () => Promise.resolve(qbStub.suspenseLegs ?? []);
    qb.getManyAndCount = () => Promise.resolve([qbStub.detailLegs ?? [], qbStub.detailTotal ?? 0]);

    return qb;
  }

  beforeEach(async () => {
    qbStub = {};

    ledgerAccountRepository = createMock<LedgerAccountRepository>();
    ledgerLegRepository = createMock<LedgerLegRepository>();
    reconciliationService = createMock<LedgerReconciliationService>();
    liquidityManagementBalanceService = createMock<LiquidityManagementBalanceService>();
    logService = createMock<LogService>();

    jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() => legQb());
    jest.spyOn(ledgerLegRepository, 'find').mockResolvedValue([]);
    jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([]);
    jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(null);
    jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([]);
    jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([]);
    // default: fresh feed (real classifyFeed reused via the actual reconciliation service in targeted tests)
    jest
      .spyOn(reconciliationService, 'classifyFeed')
      .mockReturnValue({ status: FeedStatus.FRESH } as ReturnType<LedgerReconciliationService['classifyFeed']>);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerQueryService,
        TestUtil.provideConfig({ ledger: { reconciliationToleranceChf: 1 } }),
        { provide: LedgerAccountRepository, useValue: ledgerAccountRepository },
        { provide: LedgerLegRepository, useValue: ledgerLegRepository },
        { provide: LedgerReconciliationService, useValue: reconciliationService },
        { provide: LiquidityManagementBalanceService, useValue: liquidityManagementBalanceService },
        { provide: LogService, useValue: logService },
      ],
    }).compile();

    service = module.get<LedgerQueryService>(LedgerQueryService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAccounts', () => {
    it('aggregates native + chf balances per account and attaches the recon snapshot for ASSET accounts', async () => {
      const asset = assetAccount(5, 100, 'Binance/EUR');
      const liability = createCustomLedgerAccount({
        id: 6,
        name: 'LIABILITY/buyFiat-received',
        type: AccountType.LIABILITY,
        currency: 'CHF',
      });
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([asset, liability]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([feed(100, 1000, new Date('2026-06-10T05:00:00.000Z'))]);
      qbStub.balancesByAccount = [
        { accountId: 5, native: '1000.5', chf: '950.25' },
        { accountId: 6, native: '-500', chf: '-500' },
      ];

      const res = await service.getAccounts(undefined, new Date('2026-06-11T00:00:00.000Z'));

      const assetDto = res.accounts.find((a) => a.accountId === 5);
      expect(assetDto.balanceNative).toBe(1000.5);
      expect(assetDto.balanceChf).toBe(950.25);
      // diff = 1000.5 − 1000 = 0.5 ≤ tolerance(1) → ok
      expect(assetDto.reconStatus).toBe('ok');

      const liabilityDto = res.accounts.find((a) => a.accountId === 6);
      expect(liabilityDto.balanceChf).toBe(-500);
      // non-ASSET accounts carry no feed → no recon snapshot
      expect(liabilityDto.reconStatus).toBeUndefined();
    });

    it('flags an ASSET account with a feed diff above tolerance as diff', async () => {
      const asset = assetAccount(5, 100, 'Binance/EUR');
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([asset]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([feed(100, 100, new Date('2026-06-10T05:00:00.000Z'))]);
      qbStub.balancesByAccount = [{ accountId: 5, native: '150', chf: '150' }];

      const res = await service.getAccounts();

      expect(res.accounts[0].reconStatus).toBe('diff'); // diff 50 > tolerance 1
      expect(res.accounts[0].reconDiff).toBe(50);
    });

    it('defaults missing-balance accounts to 0', async () => {
      const asset = assetAccount(5, 100, 'Binance/EUR');
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([asset]);
      qbStub.balancesByAccount = [];

      const res = await service.getAccounts();

      expect(res.accounts[0].balanceNative).toBe(0);
      expect(res.accounts[0].balanceChf).toBe(0);
    });

    // reconSnapshot lastVerified (L339): `result.staleness === 'fresh' ? feedTimestamp : undefined` — the NON-fresh
    // side. A STALE ASSET account that HAS a feed (timestamp present) must STILL yield lastVerified=undefined because
    // staleness !== 'fresh'. A broken comparator that always returned feedTimestamp would leak the stale timestamp.
    it('leaves lastVerified undefined for a STALE ASSET account even though its feed has a timestamp (L339 non-fresh)', async () => {
      const asset = assetAccount(5, 100, 'Olkypay/EUR');
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([asset]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([feed(100, 100, new Date('2026-06-01T05:00:00.000Z'))]);
      jest.spyOn(reconciliationService, 'classifyFeed').mockReturnValue({ status: FeedStatus.STALE } as any);
      qbStub.balancesByAccount = [{ accountId: 5, native: '120', chf: '120' }];

      const res = await service.getAccounts();

      const dto = res.accounts.find((a) => a.accountId === 5);
      expect(dto.reconStatus).toBe('stale'); // mapReconStatus(STALE, …) → 'stale'
      expect(dto.reconDiff).toBe(20); // ledger 120 − feed 100
      expect(dto.lastVerified).toBeUndefined(); // staleness 'stale' → non-fresh side of L339
    });
  });

  describe('getReconStatus', () => {
    it('maps fresh / stale / missing feeds to the right staleness + status', async () => {
      const fresh = assetAccount(1, 11, 'Binance/EUR');
      const stale = assetAccount(2, 12, 'Olkypay/EUR');
      const missing = assetAccount(3, 13, 'Kraken/BTC');
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([fresh, stale, missing]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([
          feed(11, 100, new Date('2026-06-10T05:00:00.000Z')),
          feed(12, 100, new Date('2026-06-01T05:00:00.000Z')),
        ]);
      jest.spyOn(reconciliationService, 'classifyFeed').mockImplementation((balance) => {
        if (!balance) return { status: FeedStatus.NO_FEED } as any;
        return {
          status: balance.asset.id === 12 ? FeedStatus.STALE : FeedStatus.FRESH,
        } as any;
      });
      // journalNativeBalance getRawOne → 100 for all (fresh: diff 0 → ok)
      qbStub.rawOne = {};
      jest.spyOn(service as any, 'journalNativeBalance').mockResolvedValue(100);

      const res = await service.getReconStatus();

      expect(res.runAt).toBeDefined();
      const byId = new Map(res.accounts.map((a) => [a.accountId, a]));
      expect(byId.get(1).staleness).toBe('fresh');
      expect(byId.get(1).status).toBe('ok');
      expect(byId.get(2).staleness).toBe('stale');
      expect(byId.get(2).status).toBe('stale');
      expect(byId.get(3).staleness).toBe('missing');
      expect(byId.get(3).status).toBe('unverified');
      expect(byId.get(3).externalFeedBalance).toBe(0);
    });

    it('skips accounts without an assetId', async () => {
      const noAsset = createCustomLedgerAccount({
        id: 9,
        name: 'ROUNDING',
        type: AccountType.ASSET,
        assetId: undefined,
      });
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([noAsset]);

      const res = await service.getReconStatus();

      expect(res.accounts).toHaveLength(0);
    });

    // mapStaleness PLACEHOLDER branch (line 370): a 1.0-placeholder feed → staleness 'placeholder', status 'unverified'
    // (mapReconStatus: non-FRESH and non-STALE → unverified). The fresh/stale/missing test never hits PLACEHOLDER.
    it('maps a placeholder feed to staleness "placeholder" and status "unverified"', async () => {
      const placeholder = assetAccount(4, 14, 'Base/ZCHF');
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([placeholder]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([feed(14, 1.0, new Date('2026-06-10T05:00:00.000Z'))]);
      jest.spyOn(reconciliationService, 'classifyFeed').mockReturnValue({ status: FeedStatus.PLACEHOLDER } as any);
      jest.spyOn(service as any, 'journalNativeBalance').mockResolvedValue(0);

      const res = await service.getReconStatus();

      const acc = res.accounts.find((a) => a.accountId === 4);
      expect(acc).toBeDefined();
      expect(acc.staleness).toBe('placeholder'); // line 370
      expect(acc.status).toBe('unverified'); // placeholder → not fresh, not stale → unverified
    });
  });

  describe('getSuspense', () => {
    it('sums chf and maps each suspense leg with its age', async () => {
      // generic untracked-bank-EUR SUSPENSE account: the test only exercises sum/age mapping. The fixture amounts are
      // deliberately small, non-calibrated values — NOT the real ~600k untracked-sweep volume — so no sensitive
      // bank↔volume correlation is committed to the public repo (Minor R12-1; that calibration lives in analysis-docs).
      const account = createCustomLedgerAccount({
        id: 3,
        name: 'SUSPENSE/untracked-bank-EUR',
        type: AccountType.SUSPENSE,
        currency: 'EUR',
      });
      const legA = makeLeg({ id: 1, amount: 5000, amountChf: 4800, account }, account, {
        bookingDate: new Date('2026-06-01T00:00:00.000Z'),
      });
      const legB = makeLeg({ id: 2, amount: 1000, amountChf: 950, account }, account, {
        bookingDate: new Date('2026-06-05T00:00:00.000Z'),
      });
      qbStub.suspenseLegs = [legA, legB];

      const res = await service.getSuspense();

      expect(res.totalChf).toBe(5750);
      expect(res.legs).toHaveLength(2);
      expect(res.legs[0].currency).toBe('EUR');
      expect(res.legs[0].age).toBeGreaterThan(0);
    });

    it('treats null amountChf as 0 in the total', async () => {
      const account = createCustomLedgerAccount({
        id: 3,
        name: 'SUSPENSE',
        type: AccountType.SUSPENSE,
        currency: 'CHF',
      });
      const legA = makeLeg({ id: 1, amount: 10, amountChf: undefined, account }, account);
      qbStub.suspenseLegs = [legA];

      const res = await service.getSuspense();

      expect(res.totalChf).toBe(0);
    });
  });

  describe('getMargin', () => {
    it('splits INCOME vs EXPENSE spread accounts by type and isolates otherOpex + fxPnl (Minor R12-4 / Major R7-2)', async () => {
      // INCOME accounts carry Cr (negative) chf; EXPENSE accounts Dr (positive) chf
      qbStub.marginRows = [
        { bucket: '2026-06-07', type: AccountType.INCOME, name: 'INCOME/fee-buyFiat', chf: '-148.50' },
        { bucket: '2026-06-07', type: AccountType.INCOME, name: 'INCOME/spread-Scrypt', chf: '-10' }, // maker rebate
        { bucket: '2026-06-07', type: AccountType.EXPENSE, name: 'EXPENSE/spread-Binance', chf: '20' },
        { bucket: '2026-06-07', type: AccountType.EXPENSE, name: 'EXPENSE/network-fee', chf: '5' },
        { bucket: '2026-06-07', type: AccountType.EXPENSE, name: 'EXPENSE/refReward', chf: '30' },
        { bucket: '2026-06-07', type: AccountType.EXPENSE, name: 'EXPENSE/extraordinary', chf: '7' },
        { bucket: '2026-06-07', type: AccountType.INCOME, name: 'INCOME/fx-revaluation', chf: '-12' },
        { bucket: '2026-06-07', type: AccountType.EXPENSE, name: 'EXPENSE/fx-revaluation', chf: '4' },
      ];

      const res = await service.getMargin(new Date('2026-06-01'), new Date('2026-06-30'), true);

      const day = res.periods[0];
      expect(day.feeIncome).toBe(158.5); // 148.50 fee + 10 rebate (both INCOME, sign-flipped)
      expect(day.executionCosts).toBe(25); // spread-Binance 20 + network-fee 5 (NOT refReward/extraordinary/fx)
      expect(day.otherOpex).toBe(37); // refReward 30 + extraordinary 7
      expect(day.fxPnl).toBe(8); // INCOME fx 12 − EXPENSE fx 4 (net gain)
      expect(day.realizedMargin).toBe(133.5); // 158.50 − 25
      expect(res.totalFeeIncome).toBe(158.5);
      expect(res.totalRealizedMargin).toBe(133.5);
      expect(res.totalOtherOpex).toBe(37);
    });

    it('does not double-count the EXPENSE spread-arbitrage into feeIncome', async () => {
      qbStub.marginRows = [
        { bucket: 'all', type: AccountType.INCOME, name: 'INCOME/trading', chf: '-100' },
        { bucket: 'all', type: AccountType.EXPENSE, name: 'EXPENSE/spread-arbitrage', chf: '40' },
        { bucket: 'all', type: AccountType.INCOME, name: 'INCOME/spread-arbitrage', chf: '-5' },
      ];

      const res = await service.getMargin(undefined, undefined, false);

      const period = res.periods[0];
      expect(period.feeIncome).toBe(105); // trading 100 + INCOME/spread-arbitrage 5 only
      expect(period.executionCosts).toBe(40); // EXPENSE/spread-arbitrage only
    });

    // default-arg (L187): getMargin(from?, to?, dailySample = true) — omit the 3rd arg so the default-param
    // initializer (`= true`) is exercised. The call must still produce a correct daily period: a day-bucketed INCOME
    // row contributes its sign-flipped magnitude to feeIncome (a sign flip would yield −42, not 42).
    it('runs with the default dailySample when called with only from/to (L187 default param)', async () => {
      qbStub.marginRows = [{ bucket: '2026-06-07', type: AccountType.INCOME, name: 'INCOME/fee-buyFiat', chf: '-42' }];

      const res = await service.getMargin(new Date('2026-06-01'), new Date('2026-06-30'));

      expect(res.periods).toHaveLength(1);
      expect(res.periods[0].date).toBe('2026-06-07'); // bucketKey normalised day key
      expect(res.periods[0].feeIncome).toBe(42); // INCOME −42 → +42 (sign-flipped magnitude)
      expect(res.totalFeeIncome).toBe(42);
    });

    // dailySample with TWO day buckets returned out of order → the periods MUST come back sorted ascending by date
    // (covers the marginBuckets `.sort((a,b) => a.date.localeCompare(b.date))` comparator, which a single bucket never
    // invokes). A broken/removed sort would leave them in insertion (reverse) order and fail this.
    it('returns daily margin periods sorted ascending by date (multi-bucket sort)', async () => {
      qbStub.marginRows = [
        { bucket: '2026-06-09', type: AccountType.INCOME, name: 'INCOME/fee-buyFiat', chf: '-20' }, // later day first
        { bucket: '2026-06-07', type: AccountType.INCOME, name: 'INCOME/fee-buyFiat', chf: '-10' },
        { bucket: '2026-06-08', type: AccountType.EXPENSE, name: 'EXPENSE/network-fee', chf: '5' },
      ];

      const res = await service.getMargin(new Date('2026-06-01'), new Date('2026-06-30'), true);

      expect(res.periods.map((p) => p.date)).toEqual(['2026-06-07', '2026-06-08', '2026-06-09']); // ascending, sorted
      expect(res.periods[0].feeIncome).toBe(10); // 2026-06-07 bucket
      expect(res.periods[2].feeIncome).toBe(20); // 2026-06-09 bucket
    });
  });

  describe('getEquityComparison', () => {
    function financeLog(created: string, totalBalanceChf: number): Log {
      return Object.assign(new Log(), {
        id: 1,
        created: new Date(created),
        message: JSON.stringify({
          assets: {},
          tradings: {},
          balancesByFinancialType: {},
          balancesTotal: { totalBalanceChf },
        }),
      });
    }

    it('computes journalEquity, difference and the four-bucket decomposition (other = residual)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([financeLog('2026-06-10T00:00:00.000Z', 20000)]);
      jest.spyOn(service as any, 'journalEquityAt').mockResolvedValue(19000);
      jest.spyOn(service as any, 'transitPhantom').mockResolvedValue(-500);
      jest.spyOn(service as any, 'staleFeed').mockResolvedValue(-200);
      jest.spyOn(service as any, 'spreadFees').mockResolvedValue(-100);

      const res = await service.getEquityComparison(undefined, true);

      const period = res.periods[0];
      expect(period.journalEquity).toBe(19000);
      expect(period.financialDataLogTotal).toBe(20000);
      expect(period.difference).toBe(-1000); // 19000 − 20000
      // other = difference − (transit + stale + spread) = −1000 − (−800) = −200
      expect(period.decomposition.transitPhantom).toBe(-500);
      expect(period.decomposition.staleFeed).toBe(-200);
      expect(period.decomposition.spreadFees).toBe(-100);
      expect(period.decomposition.other).toBe(-200);
      const { transitPhantom, staleFeed, spreadFees, other } = period.decomposition;
      expect(Util.round(transitPhantom + staleFeed + spreadFees + other, 2)).toBe(period.difference);
    });

    it('skips logs without a totalBalanceChf', async () => {
      const broken = Object.assign(new Log(), { id: 2, created: new Date(), message: '{ not json' });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([broken]);

      const res = await service.getEquityComparison();

      expect(res.periods).toHaveLength(0);
    });
  });

  describe('getAccountDetail', () => {
    it('returns an empty shell for an unknown account', async () => {
      jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(null);

      const res = await service.getAccountDetail(999);

      expect(res.legs).toHaveLength(0);
      expect(res.total).toBe(0);
      expect(res.openingBalance).toBe(0);
    });

    it('maps legs with opening/closing balance and a 2-leg counter account', async () => {
      const account = createCustomLedgerAccount({
        id: 5,
        name: 'ASSET/bank-CHF',
        type: AccountType.ASSET,
        currency: 'CHF',
      });
      const counter = createCustomLedgerAccount({ id: 6, name: 'LIABILITY/buyFiat-owed', type: AccountType.LIABILITY });
      jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(account);

      const leg5 = makeLeg({ id: 1, txId: 10, accountId: 5, amount: 100, amountChf: 100, account }, account, {
        id: 10,
      });
      const legCounter = makeLeg({ id: 2, txId: 10, accountId: 6, amount: -100, account: counter }, counter, {
        id: 10,
      });
      qbStub.detailLegs = [leg5];
      qbStub.detailTotal = 1;
      jest.spyOn(ledgerLegRepository, 'find').mockResolvedValue([leg5, legCounter]);
      jest.spyOn(service as any, 'nativeBalanceBefore').mockResolvedValue(50);
      jest.spyOn(service as any, 'nativeBalanceInPeriod').mockResolvedValue(100);

      const res = await service.getAccountDetail(5, new Date('2026-06-01'), new Date('2026-06-30'), 0);

      expect(res.accountName).toBe('ASSET/bank-CHF');
      expect(res.currency).toBe('CHF');
      expect(res.openingBalance).toBe(50);
      expect(res.closingBalance).toBe(150); // 50 + 100
      expect(res.total).toBe(1);
      expect(res.legs).toHaveLength(1);
      expect(res.legs[0].counterAccountId).toBe(6);
      expect(res.legs[0].counterAccountName).toBe('LIABILITY/buyFiat-owed');
    });

    it('returns undefined counter account for a ≥3-leg tx (no single counterparty)', async () => {
      const account = createCustomLedgerAccount({ id: 5, name: 'ASSET/bank-CHF', type: AccountType.ASSET });
      const a = createCustomLedgerAccount({ id: 6, name: 'EXPENSE/network-fee', type: AccountType.EXPENSE });
      const b = createCustomLedgerAccount({ id: 7, name: 'LIABILITY/owed', type: AccountType.LIABILITY });
      jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(account);

      const leg5 = makeLeg({ id: 1, txId: 10, accountId: 5, amount: 100, amountChf: 100, account }, account, {
        id: 10,
      });
      // a 3-leg tx: account 5 + TWO counterparts → no single counter account
      const legA = makeLeg({ id: 2, txId: 10, accountId: 6, amount: -60, account: a }, a, { id: 10 });
      const legB = makeLeg({ id: 3, txId: 10, accountId: 7, amount: -40, account: b }, b, { id: 10 });
      qbStub.detailLegs = [leg5];
      qbStub.detailTotal = 1;
      jest.spyOn(ledgerLegRepository, 'find').mockResolvedValue([leg5, legA, legB]);
      jest.spyOn(service as any, 'nativeBalanceBefore').mockResolvedValue(0);
      jest.spyOn(service as any, 'nativeBalanceInPeriod').mockResolvedValue(100);

      const res = await service.getAccountDetail(5, undefined, undefined, 0);

      expect(res.legs[0].counterAccountId).toBeUndefined(); // ≥3-leg → no single counter party
    });
  });

  // --- REAL QUERY-BUILDER PATHS (the private balance helpers run against a captured getRawOne, NOT mocked away) --- //

  // A query-builder whose getRawOne returns a value keyed by what the query selects/filters, so the actual private
  // helpers (nativeBalanceBefore/InPeriod, journalNativeBalance, journalEquityAt, transitPhantom, staleFeed,
  // spreadFees) execute their COALESCE `?? 0` rounding paths instead of being stubbed.
  describe('balance helpers run against the real query-builder', () => {
    // keyed resolution of getRawOne by a discriminator captured from select/where clauses
    function richLegQb(resolve: (selects: string, wheres: string) => Record<string, unknown> | null): any {
      const qb: any = { _selects: [] as string[], _wheres: [] as string[] };
      const chain = () => qb;
      qb.innerJoin = chain;
      qb.innerJoinAndSelect = chain;
      qb.select = (e: string) => (qb._selects.push(e), qb);
      qb.addSelect = (e: string) => (qb._selects.push(e), qb);
      qb.where = (e: string) => (qb._wheres.push(e), qb);
      qb.andWhere = (e: string) => (qb._wheres.push(e), qb);
      qb.groupBy = chain;
      qb.addGroupBy = chain;
      qb.orderBy = chain;
      qb.addOrderBy = chain;
      qb.skip = chain;
      qb.take = chain;
      qb.getRawOne = () => Promise.resolve(resolve(qb._selects.join(' '), qb._wheres.join(' ')));
      qb.getRawMany = () => Promise.resolve([]);
      qb.getManyAndCount = () => Promise.resolve([[], 0]);
      qb.getMany = () => Promise.resolve([]);
      return qb;
    }

    it('getAccountDetail computes opening/closing from the real native-balance query-builder (COALESCE rounding)', async () => {
      const account = createCustomLedgerAccount({ id: 5, name: 'ASSET/bank-CHF', type: AccountType.ASSET });
      jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(account);
      jest.spyOn(ledgerLegRepository, 'find').mockResolvedValue([]);

      jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() =>
        richLegQb((_selects, wheres) => {
          // nativeBalanceBefore → `tx.bookingDate < :from`; nativeBalanceInPeriod → `>= :from` AND `<= :to`
          if (wheres.includes('< :from')) return { native: '50.123456789' }; // opening (rounded to 8 dp)
          if (wheres.includes('>= :from')) return { native: '100' }; // period native
          return { native: '0' };
        }),
      );

      const res = await service.getAccountDetail(5, new Date('2026-06-01'), new Date('2026-06-30'), 0);

      expect(res.openingBalance).toBe(50.12345679); // Util.round(…, 8) on the real getRawOne value
      expect(res.closingBalance).toBe(150.12345679); // opening + 100
    });

    it('nativeBalanceBefore defaults to 0 when getRawOne returns null (no legs before the period)', async () => {
      const account = createCustomLedgerAccount({ id: 5, name: 'ASSET/bank-CHF', type: AccountType.ASSET });
      jest.spyOn(ledgerAccountRepository, 'findOneBy').mockResolvedValue(account);
      jest.spyOn(ledgerLegRepository, 'find').mockResolvedValue([]);
      jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() =>
        richLegQb((_selects, wheres) => {
          if (wheres.includes('>= :from')) return { native: '100' };
          return null; // nativeBalanceBefore getRawOne → null → ?? 0
        }),
      );

      const res = await service.getAccountDetail(5, new Date('2026-06-01'), new Date('2026-06-30'), 0);

      expect(res.openingBalance).toBe(0); // null getRawOne → 0
      expect(res.closingBalance).toBe(100);
    });

    it('getReconStatus uses the real journalNativeBalance (null getRawOne → ledger balance 0)', async () => {
      const asset = assetAccount(1, 11, 'Binance/EUR');
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([asset]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([feed(11, 0, new Date('2026-06-10T05:00:00.000Z'))]);
      // journalNativeBalance getRawOne → null → 0; feed amount 0 → diff 0 → ok (fresh by default mock)
      jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() => richLegQb(() => null));

      const res = await service.getReconStatus();

      expect(res.accounts[0].ledgerBalance).toBe(0); // SUM(amount) null → 0
      expect(res.accounts[0].status).toBe('ok'); // diff 0 ≤ tolerance
    });

    it('getEquityComparison runs the real journalEquityAt + decomposition query-builders (residual = other)', async () => {
      const log = Object.assign(new Log(), {
        id: 1,
        created: new Date('2026-06-10T00:00:00.000Z'),
        message: JSON.stringify({
          assets: {},
          tradings: {},
          balancesByFinancialType: {},
          balancesTotal: { totalBalanceChf: 20000 },
        }),
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([log]);
      // an unverified ASSET account drives unverifiedAccountIds → the staleFeed query actually runs (not skipped)
      const unverified = assetAccount(2, 12, 'Olkypay/EUR');
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([unverified]);
      jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([]);
      jest.spyOn(reconciliationService, 'classifyFeed').mockReturnValue({ status: FeedStatus.NO_FEED } as any);

      jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() =>
        richLegQb((_selects, wheres) => {
          // staleFeed: mark_to_market sourceType + accountId IN (unverified) → −200 (check FIRST, no account.type)
          if (wheres.includes('tx.sourceType = :sourceType')) return { chf: '-200' };
          // spreadFees: EXPENSE type + account.name NOT IN (...) → −100 (has account.type = :type too → check before it)
          if (wheres.includes('account.name NOT IN')) return { chf: '-100' };
          // journalEquityAt: balance-account types IN (...) → 19000
          if (wheres.includes('account.type IN')) return { chf: '19000' };
          // transitPhantom: account.type = :type (TRANSIT) → −500
          if (wheres.includes('account.type = :type')) return { chf: '-500' };
          return { chf: '0' };
        }),
      );

      const res = await service.getEquityComparison(undefined, true);

      const period = res.periods[0];
      expect(period.journalEquity).toBe(19000);
      expect(period.difference).toBe(-1000); // 19000 − 20000
      expect(period.decomposition.transitPhantom).toBe(-500);
      expect(period.decomposition.staleFeed).toBe(-200);
      expect(period.decomposition.spreadFees).toBe(-100);
      expect(period.decomposition.other).toBe(-200); // −1000 − (−800)
    });

    // null-COALESCE fallbacks across the equity decomposition: journalEquityAt (L470), transitPhantom (L493),
    // staleFeed (L510) and spreadFees (L527) each do `+(raw?.chf ?? 0)` — drive EVERY getRawOne to null so all four
    // `?? 0` null sides fire (each helper → 0). Additionally unverifiedAccountIds (L540) sees an ASSET account whose
    // assetId is null → `if (account.assetId == null) return false` (the false guard) plus a genuinely-unverified
    // (NO_FEED) account, so the list is non-empty and the staleFeed SUM query actually executes (not short-circuited).
    it('null getRawOne drives every equity-decomposition ?? 0 to 0 and skips a null-assetId account in the unverified scan (L470/L493/L510/L527/L540)', async () => {
      const log = Object.assign(new Log(), {
        id: 1,
        created: new Date('2026-06-10T00:00:00.000Z'),
        message: JSON.stringify({ balancesTotal: { totalBalanceChf: 20000 } }),
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([log]);

      const nullAssetIdAccount = createCustomLedgerAccount({
        id: 7,
        name: 'ASSET/no-asset-link',
        type: AccountType.ASSET,
        assetId: undefined, // → L540 false guard, skipped before classifyFeed
      });
      const unverified = assetAccount(2, 12, 'Olkypay/EUR'); // NO_FEED → non-fresh → keeps the list non-empty
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([nullAssetIdAccount, unverified]);
      jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([]);
      jest.spyOn(reconciliationService, 'classifyFeed').mockReturnValue({ status: FeedStatus.NO_FEED } as any);

      let staleQueryRan = false;
      jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() =>
        richLegQb((_selects, wheres) => {
          if (wheres.includes('tx.sourceType = :sourceType')) staleQueryRan = true; // staleFeed SUM query executed
          return null; // every getRawOne → null → +(raw?.chf ?? 0) → 0 for all four helpers
        }),
      );

      const res = await service.getEquityComparison(undefined, true);

      const period = res.periods[0];
      expect(staleQueryRan).toBe(true); // unverified list non-empty (null-assetId account skipped, NO_FEED kept) → SUM ran
      expect(period.journalEquity).toBe(0); // journalEquityAt null chf → 0 (L470)
      expect(period.difference).toBe(-20000); // 0 − 20000
      expect(period.decomposition.transitPhantom).toBe(0); // L493
      expect(period.decomposition.staleFeed).toBe(0); // L510
      expect(period.decomposition.spreadFees).toBe(0); // L527
      expect(period.decomposition.other).toBe(-20000); // −20000 − (0+0+0) residual
    });

    it('staleFeed short-circuits to 0 when there are no unverified accounts', async () => {
      const log = Object.assign(new Log(), {
        id: 1,
        created: new Date('2026-06-10T00:00:00.000Z'),
        message: JSON.stringify({ balancesTotal: { totalBalanceChf: 100 } }),
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([log]);
      // a FRESH account → unverifiedAccountIds is empty → staleFeed returns 0 WITHOUT running the SUM query
      const fresh = assetAccount(1, 11, 'Binance/EUR');
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([fresh]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([feed(11, 0, new Date('2026-06-10T05:00:00.000Z'))]);
      jest.spyOn(reconciliationService, 'classifyFeed').mockReturnValue({ status: FeedStatus.FRESH } as any);

      let staleQueryRan = false;
      jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() =>
        richLegQb((_selects, wheres) => {
          if (wheres.includes('tx.sourceType = :sourceType')) staleQueryRan = true; // staleFeed SUM query
          if (wheres.includes('account.type IN')) return { chf: '100' };
          return { chf: '0' };
        }),
      );

      const res = await service.getEquityComparison(undefined, true);

      expect(staleQueryRan).toBe(false); // no unverified accounts → the staleFeed SUM query is never executed
      expect(res.periods[0].decomposition.staleFeed).toBe(0);
    });
  });

  // --- getAccounts balancesByAccount real aggregation + getMargin empty / unknown-bucket --- //

  describe('aggregation edge cases', () => {
    it('getMargin returns empty totals when no INCOME/EXPENSE rows exist in the period', async () => {
      qbStub.marginRows = [];

      const res = await service.getMargin(new Date('2026-06-01'), new Date('2026-06-30'), true);

      expect(res.periods).toHaveLength(0);
      expect(res.totalFeeIncome).toBe(0);
      expect(res.totalExecutionCosts).toBe(0);
      expect(res.totalRealizedMargin).toBe(0);
    });

    it('getMargin normalises a DATE bucket value to a YYYY-MM-DD day key (dailySample driver shape)', async () => {
      // a driver may return the CAST(... AS DATE) bucket as a full timestamp string → bucketKey must slice the day
      qbStub.marginRows = [
        { bucket: '2026-06-07T00:00:00.000Z', type: AccountType.INCOME, name: 'INCOME/fee-buyFiat', chf: '-10' },
      ];

      const res = await service.getMargin(new Date('2026-06-01'), new Date('2026-06-30'), true);

      expect(res.periods[0].date).toBe('2026-06-07'); // normalised day key
      expect(res.periods[0].feeIncome).toBe(10);
    });

    it('getSuspense returns 0 total and no legs when there are no SUSPENSE legs', async () => {
      qbStub.suspenseLegs = [];

      const res = await service.getSuspense();

      expect(res.totalChf).toBe(0);
      expect(res.legs).toHaveLength(0);
    });
  });
});
