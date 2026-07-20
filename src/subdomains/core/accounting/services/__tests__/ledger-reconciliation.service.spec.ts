import { createMock } from '@golevelup/ts-jest';
import { CronExpression } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Process } from 'src/shared/services/process.service';
import { DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { LiquidityBalance } from 'src/subdomains/core/liquidity-management/entities/liquidity-balance.entity';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountRepository } from '../../repositories/ledger-account.repository';
import { LedgerLegRepository } from '../../repositories/ledger-leg.repository';
import { LedgerBookingJobService } from '../ledger-booking-job.service';
import { LedgerMarkService } from '../ledger-mark.service';
import { CustodyClass, FeedStatus, LedgerReconciliationService } from '../ledger-reconciliation.service';

interface LegQueryStub {
  native?: string; // journal native balance per account (fed through the nativeBalanceByAccount map, §7.0 m8)
  equityChf?: string; // journalEquity getRawOne
  // checkTransitAge open-account candidates (F3); §2.3 base-unit fields optional (absent ⇒ float pre-filter verdict)
  transit?: {
    id: number;
    name: string;
    assetId?: number | null; // MAX(asset.id): a single-asset account (⇒ one decimals) ⇒ non-null; a shared/bridge transit ⇒ null
    native: string;
    baseUnits?: string | null;
    legCount?: string;
    valuedCount?: string;
  }[];
  // openResidualSince per-account ordered legs (F3); baseUnits present but IGNORED for an assetId-less account (float path)
  transitLegs?: { amount: string; baseUnits?: string | null; bookingDate: Date }[];
  suspense?: { name: string; chf: string }[];
}

describe('LedgerReconciliationService', () => {
  let service: LedgerReconciliationService;

  let jobService: LedgerBookingJobService;
  let settingService: SettingService;
  let logService: LogService;
  let notificationService: NotificationService;
  let liquidityManagementBalanceService: LiquidityManagementBalanceService;
  let ledgerAccountRepository: LedgerAccountRepository;
  let ledgerLegRepository: LedgerLegRepository;
  let markService: LedgerMarkService;
  let refRewardService: RefRewardService;

  let mails: MailRequest[];
  let legStub: LegQueryStub;
  let nativeBalanceSpy: jest.SpyInstance;

  function assetAccount(assetId: number, asset?: Partial<Asset>): LedgerAccount {
    return createCustomLedgerAccount({
      id: 1000 + assetId,
      name: `Asset/${assetId}`,
      type: AccountType.ASSET,
      assetId,
      asset: asset ? (Object.assign(new Asset(), { id: assetId, ...asset }) as Asset) : undefined,
    } as any);
  }

  function balance(assetId: number, amount: number, updated: Date): LiquidityBalance {
    return Object.assign(new LiquidityBalance(), { asset: { id: assetId } as Asset, amount, updated });
  }

  // the last N VALID FinancialDataLog snapshots (getLatestValidFinancialLogs), one per totalBalanceChf value
  function validLogs(totals: number[]): Log[] {
    return totals.map((totalBalanceChf, i) =>
      Object.assign(new Log(), {
        id: 100 + i,
        created: new Date('2026-06-11T00:00:00Z'),
        valid: true,
        message: JSON.stringify({
          assets: {},
          tradings: {},
          balancesByFinancialType: {},
          balancesTotal: { totalBalanceChf },
        }),
      }),
    );
  }

  // chainable leg query-builder stub resolving its terminal method by the captured select/where expressions
  function legQb(): any {
    const qb: any = { _selects: [] as string[], _wheres: [] as string[] };
    const chain = () => qb;
    qb.innerJoin = chain;
    qb.leftJoin = chain; // checkTransitAge now leftJoins account.asset to read MAX(asset.id) (single-asset gate)
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
    qb.andWhere = chain;
    qb.orderBy = chain;
    qb.addOrderBy = chain;
    qb.groupBy = chain;
    qb.addGroupBy = chain;
    qb.having = chain;
    qb.getRawMany = () => {
      const selects = qb._selects.join(' ');
      if (selects.includes('bookingDate')) return Promise.resolve(legStub.transitLegs ?? []); // openResidualSince (F3)
      if (selects.includes('COALESCE')) return Promise.resolve(legStub.suspense ?? []); // checkSuspense (Σ COALESCE amountChf)
      if (selects.includes('SUM(leg.amount)')) return Promise.resolve(legStub.transit ?? []); // checkTransitAge candidates
      return Promise.resolve([]);
    };
    qb.getRawOne = () => {
      const wheres = qb._wheres.join(' ');
      if (wheres.includes('account.type IN')) return Promise.resolve({ chf: legStub.equityChf ?? '0' }); // journalEquity
      return Promise.resolve({ native: legStub.native ?? '0' }); // journalNativeBalance
    };
    return qb;
  }

  beforeEach(async () => {
    mails = [];
    legStub = {};

    jobService = createMock<LedgerBookingJobService>();
    settingService = createMock<SettingService>();
    logService = createMock<LogService>();
    notificationService = createMock<NotificationService>();
    liquidityManagementBalanceService = createMock<LiquidityManagementBalanceService>();
    ledgerAccountRepository = createMock<LedgerAccountRepository>();
    ledgerLegRepository = createMock<LedgerLegRepository>();
    markService = createMock<LedgerMarkService>();
    refRewardService = createMock<RefRewardService>();

    jest.spyOn(jobService, 'isLedgerReady').mockResolvedValue(true);
    jest.spyOn(notificationService, 'sendMail').mockImplementation((request: MailRequest) => {
      mails.push(request);
      return Promise.resolve();
    });
    jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([]);
    jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([]);
    jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() => legQb());
    jest.spyOn(settingService, 'get').mockResolvedValue('0');
    // default: a mark of 1 CHF/native for every asset (diffChf == native diff) so the diff-alarm tests read cleanly;
    // Finding-4 tests override preload with a realistic mark (e.g. BTC 52'000, meme-coin 1e-7, or no mark).
    jest.spyOn(markService, 'preload').mockResolvedValue({ getMarkAt: () => 1 } as any);
    jest.spyOn(refRewardService, 'getOpenRefCreditLiability').mockResolvedValue({ amountEur: 0, amountChf: 0 });
    // default: no valid snapshot → equity parity skipped (the §7.6 tests override this with real snapshots)
    jest.spyOn(logService, 'getLatestValidFinancialLogs').mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerReconciliationService,
        TestUtil.provideConfig(),
        { provide: LedgerBookingJobService, useValue: jobService },
        { provide: SettingService, useValue: settingService },
        { provide: LogService, useValue: logService },
        { provide: NotificationService, useValue: notificationService },
        { provide: LiquidityManagementBalanceService, useValue: liquidityManagementBalanceService },
        { provide: LedgerAccountRepository, useValue: ledgerAccountRepository },
        { provide: LedgerLegRepository, useValue: ledgerLegRepository },
        { provide: LedgerMarkService, useValue: markService },
        { provide: RefRewardService, useValue: refRewardService },
      ],
    }).compile();

    service = module.get<LedgerReconciliationService>(LedgerReconciliationService);

    // §7.0 (m8): journal native balances come from ONE GROUP-BY map (nativeBalanceByAccount). The default map yields
    // legStub.native for EVERY account (mirrors the former per-account getRawOne default); the dedicated getRawMany
    // test restores this spy to exercise the real GROUP-BY→map wiring.
    nativeBalanceSpy = jest
      .spyOn(service as any, 'nativeBalanceByAccount')
      .mockImplementation(() => Promise.resolve({ get: () => Util.round(+(legStub.native ?? '0'), 8) }));
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('runs off-peak at 05:00 (1h after mark-to-market) with its own LEDGER_RECONCILIATION kill-switch', () => {
    const params: DfxCronParams = Reflect.getMetadata(DFX_CRONJOB_PARAMS, LedgerReconciliationService.prototype.run);
    expect(params.expression).toBe(CronExpression.EVERY_DAY_AT_5AM);
    expect(params.process).toBe(Process.LEDGER_RECONCILIATION);
  });

  it('no-ops while the ledger is not ready (cutover-gate)', async () => {
    jest.spyOn(jobService, 'isLedgerReady').mockResolvedValue(false);

    await service.run();

    expect(liquidityManagementBalanceService.getBalances).not.toHaveBeenCalled();
  });

  it('reads the feed exactly once per run (§7.0 Minor R13-2)', async () => {
    jest.spyOn(logService, 'getLatestValidFinancialLogs').mockResolvedValue(validLogs([1000]));

    await service.run();

    expect(liquidityManagementBalanceService.getBalances).toHaveBeenCalledTimes(1);
  });

  describe('staleness classification (§7.1)', () => {
    const now = new Date('2026-06-11T12:00:00Z');

    it('classifies a 1.0 placeholder feed as PLACEHOLDER (never reconcile)', () => {
      const account = assetAccount(5, { blockchain: Blockchain.ETHEREUM });
      const result = service.classifyFeed(balance(5, 1.0, now), account, now);
      expect(result.status).toBe(FeedStatus.PLACEHOLDER);
    });

    it('classifies a missing feed as NO_FEED', () => {
      const account = assetAccount(5, { blockchain: Blockchain.ETHEREUM });
      expect(service.classifyFeed(undefined, account, now).status).toBe(FeedStatus.NO_FEED);
    });

    it('classifies a recent on-chain feed as FRESH (within 4h)', () => {
      const account = assetAccount(5, { blockchain: Blockchain.ETHEREUM });
      const result = service.classifyFeed(balance(5, 123, Util.hoursBefore(2, now)), account, now);
      expect(result.status).toBe(FeedStatus.FRESH);
    });

    it('classifies an old on-chain feed as STALE (beyond 4h)', () => {
      const account = assetAccount(5, { blockchain: Blockchain.ETHEREUM });
      const result = service.classifyFeed(balance(5, 123, Util.hoursBefore(10, now)), account, now);
      expect(result.status).toBe(FeedStatus.STALE);
    });

    it('gives a bank-custody account the 96h SEPA threshold (fresh at 50h)', () => {
      const account = assetAccount(269, { bank: { id: 1 } as any });
      const result = service.classifyFeed(balance(269, 5000, Util.hoursBefore(50, now)), account, now);
      expect(result.status).toBe(FeedStatus.FRESH);
      expect(result.thresholdHours).toBe(96);
    });
  });

  describe('asset reconciliation + alarm suppression (§7.2/§7.3)', () => {
    it('emits a tolerance-respecting diff alarm for a fresh account out of balance', async () => {
      const now = new Date();
      jest
        .spyOn(ledgerAccountRepository, 'find')
        .mockResolvedValue([assetAccount(5, { blockchain: Blockchain.ETHEREUM })]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([balance(5, 100, Util.hoursBefore(1, now))]);
      legStub.native = '150'; // journal 150 vs feed 100 → diff 50 > tolerance

      await service.run();

      const reconMail = mails.find((m) => m.context === MailContext.LEDGER_RECONCILIATION);
      expect(reconMail).toBeDefined();
      expect(reconMail.type).toBe(MailType.ERROR_MONITORING);
      // suppression: a per-account/day correlationId + suppressRecurring (§7.3)
      expect(reconMail.correlationId).toContain('ledger-recon-');
      expect(reconMail.options?.suppressRecurring).toBe(true);
    });

    it('aggregates unverified (stale) accounts into ONE daily alarm, no per-asset spam (§7.3)', async () => {
      const now = new Date();
      jest
        .spyOn(ledgerAccountRepository, 'find')
        .mockResolvedValue([
          assetAccount(5, { blockchain: Blockchain.ETHEREUM }),
          assetAccount(6, { blockchain: Blockchain.ETHEREUM }),
        ]);
      jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([
        balance(5, 100, Util.hoursBefore(10, now)), // stale
        balance(6, 200, Util.hoursBefore(10, now)), // stale
      ]);

      await service.run();

      const reconMails = mails.filter((m) => m.context === MailContext.LEDGER_RECONCILIATION);
      expect(reconMails).toHaveLength(1); // single aggregated alarm
      expect(reconMails[0].correlationId).toContain('ledger-unverified-');
    });

    it('paginates the ASSET-account universe in batches — accounts beyond the first batch ARE reconciled (Minor R13-2, MAJOR)', async () => {
      const now = new Date();

      // simulate a universe larger than backfillBatchSize by paginating: a full first page (= batchSize accounts)
      // then a short final page containing the account that the OLD truncating code would never have reconciled.
      // The id-watermark loop must request the second page and reconcile it.
      const { Config } = await import('src/config/config');
      const size = Config.ledger.backfillBatchSize;

      const firstPage = Array.from({ length: size }, (_, i) =>
        assetAccount(1000 + i, { blockchain: Blockchain.ETHEREUM }),
      );
      const beyondBatch = assetAccount(9999, { blockchain: Blockchain.ETHEREUM });

      jest.spyOn(ledgerAccountRepository, 'find').mockImplementation((options: any) => {
        const lastId = options?.where?.id?._value ?? options?.where?.id?.value ?? 0;
        if (lastId === 0) return Promise.resolve(firstPage); // page 1 (full → loop continues)
        return Promise.resolve([beyondBatch]); // page 2 (short → loop ends)
      });

      // a fresh feed for the beyond-batch account that is OUT of balance → must produce a diff alarm if reconciled
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([balance(9999, 100, Util.hoursBefore(1, now))]);
      legStub.native = '150'; // journal 150 vs feed 100 → diff 50 > tolerance

      await service.run();

      // the OLD code (single find, take: batchSize) would never have loaded account 9999 → no alarm; the paginated
      // loop reconciles it → a per-account diff alarm proves the second page was visited.
      const reconMail = mails.find(
        (m) => m.context === MailContext.LEDGER_RECONCILIATION && m.correlationId?.includes('ledger-recon-'),
      );
      expect(reconMail).toBeDefined();
      expect(ledgerAccountRepository.find).toHaveBeenCalledTimes(2); // two pages requested
    });

    // §7.0 line 128: an ASSET account with a null assetId is skipped in reconcileAssets (no feed key) — no alarm,
    // no crash. A second real account in the same batch still reconciles, proving the loop continues past the skip.
    it('skips an ASSET account with a null assetId during reconciliation (continue)', async () => {
      const now = new Date();
      const noAsset = createCustomLedgerAccount({
        id: 500,
        name: 'PHANTOM',
        type: AccountType.ASSET,
        assetId: undefined,
      } as any);
      const real = assetAccount(5, { blockchain: Blockchain.ETHEREUM });
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([noAsset, real]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([balance(5, 100, Util.hoursBefore(1, now))]);
      legStub.native = '150'; // the REAL account is out of balance → its diff alarm proves the loop didn't abort

      await service.run();

      const reconMail = mails.find((m) => m.correlationId?.includes('ledger-recon-'));
      expect(reconMail).toBeDefined(); // account 5 still reconciled (the null-assetId one was skipped, not fatal)
    });

    // §7 line 202: reconcileFreshAsset treats a null feed amount as 0 (the `balance.amount ?? 0` fallback). A fresh
    // balance whose amount is null + a non-zero journal → diff = journal − 0 → alarm.
    it('treats a null feed amount as 0 when computing the diff (balance.amount ?? 0)', async () => {
      const now = new Date();
      jest
        .spyOn(ledgerAccountRepository, 'find')
        .mockResolvedValue([assetAccount(5, { blockchain: Blockchain.ETHEREUM })]);
      // a present, FRESH balance whose amount is null → classifyFeed must say FRESH for reconcileFreshAsset to run;
      // force FRESH via the spy, feed amount null → feedAmount 0 → diff = 150 − 0 = 150 > tolerance → alarm
      const nullAmt = Object.assign(new LiquidityBalance(), { asset: { id: 5 } as any, amount: null, updated: now });
      jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([nullAmt]);
      jest.spyOn(service, 'classifyFeed').mockReturnValue({ status: FeedStatus.FRESH } as any);
      legStub.native = '150';

      await service.run();

      const reconMail = mails.find((m) => m.correlationId?.includes('ledger-recon-'));
      expect(reconMail).toBeDefined();
      const errors = (reconMail.input as { errors: string[] }).errors;
      expect(errors[0]).toContain('feed 0'); // null feed amount → 0 (the `balance.amount ?? 0` fallback)
    });

    it('does NOT alarm on a placeholder feed (§7.1)', async () => {
      const now = new Date();
      jest
        .spyOn(ledgerAccountRepository, 'find')
        .mockResolvedValue([assetAccount(5, { blockchain: Blockchain.ETHEREUM })]);
      jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([balance(5, 1.0, now)]);

      await service.run();

      expect(mails.filter((m) => m.context === MailContext.LEDGER_RECONCILIATION)).toHaveLength(0);
    });

    // m3: reconcileAssets MUST eager-load account.asset (+ its bank), else classifyCustody(account.asset) sees
    // undefined → every account falls to ON_CHAIN_INACTIVE (24h) and bank accounts (should be 96h BANK_ACTIVE) are
    // wrongly reported unverified. Assert both the relations on the find AND the resulting BANK_ACTIVE classification.
    it('loads account.asset with its bank so a bank account classifies BANK_ACTIVE (96h), not ON_CHAIN_INACTIVE (m3)', async () => {
      const now = new Date();
      const bankAccount = assetAccount(269, { bank: { id: 1 } as any });
      const findSpy = jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([bankAccount]);
      // a 50h-old bank feed is FRESH under the 96h SEPA threshold; matching journal → no diff, no unverified alarm
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([balance(269, 5000, Util.hoursBefore(50, now))]);
      legStub.native = '5000';

      await service.run();

      // the eager relation is the fix — without it classifyCustody(account.asset) sees undefined → ON_CHAIN_INACTIVE
      expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({ relations: { asset: { bank: true } } }));
      // BANK_ACTIVE (96h) → the 50h feed stays FRESH → neither an unverified nor a diff alarm
      expect(mails.some((m) => m.correlationId?.includes('ledger-unverified-'))).toBe(false);
      expect(mails.some((m) => m.correlationId?.includes('ledger-recon-'))).toBe(false);
      // and the classification itself: a bank-linked asset → BANK_ACTIVE 96h threshold (via classifyFeed)
      expect(service.classifyFeed(balance(269, 5000, Util.hoursBefore(50, now)), bankAccount, now).thresholdHours).toBe(
        96,
      );
    });
  });

  // m8: the journal native balance for reconcileFreshAsset comes from ONE GROUP-BY pass (nativeBalanceByAccount),
  // not a per-account SUM query inside the batched loop. The map keys on account.id (Σ leg.amount per account).
  describe('journal native balance GROUP-BY map (§7.0 / m8)', () => {
    it('nativeBalanceByAccount sums exact base units for decimals-bearing accounts, float otherwise', async () => {
      nativeBalanceSpy.mockRestore(); // exercise the REAL helper (not the default spy)

      const qb: any = {};
      qb.innerJoin = () => qb;
      qb.leftJoin = () => qb;
      qb.select = () => qb;
      qb.addSelect = () => qb;
      qb.groupBy = () => qb;
      qb.getRawMany = () =>
        Promise.resolve([
          // decimals-bearing + every leg valued → EXACT base-unit path (the float 150.5 is accumulated drift, ignored)
          { accountId: 1005, native: '150.5', baseUnits: '15012345678', legCount: '3', valuedCount: '3', decimals: 8 },
          // no asset decimals (fiat / TRANSIT) → raw float Σ amount
          { accountId: 1006, native: '-2.5', baseUnits: null, legCount: '1', valuedCount: '0', decimals: null },
          // decimals present but NOT all legs valued → float fallback (a null-swallowed partial SUM would understate)
          { accountId: 1007, native: '10.25', baseUnits: '1000000000', legCount: '3', valuedCount: '2', decimals: 8 },
        ]);
      jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockReturnValue(qb);

      const map = await (service as any).nativeBalanceByAccount();

      expect(map.get(1005)).toBe(Util.round(150.12345678, 8)); // 15012345678 base units ÷ 1e8, not the float 150.5
      expect(map.get(1006)).toBe(-2.5); // no decimals → float fallback
      expect(map.get(1007)).toBe(10.25); // partial-valued → float fallback (decimals never invented)
      expect(map.get(9999)).toBeUndefined(); // an account absent from the aggregate → caller falls back to ?? 0
    });
  });

  describe('transit-age + suspense alarms (§7.4/§7.5)', () => {
    it('emits a transit-overdue alarm for an open transit balance older than the threshold', async () => {
      const oldDate = Util.daysBefore(10); // well beyond the 3-day default threshold
      legStub.transit = [{ id: 7, name: 'TRANSIT/payout/CHF', native: '14851.5' }];
      legStub.transitLegs = [{ amount: '14851.5', bookingDate: oldDate }]; // opened 10d ago, never closed → open since then

      await service.run();

      expect(mails.some((m) => m.context === MailContext.LEDGER_TRANSIT_OVERDUE)).toBe(true);
    });

    // §2.3 mixed-decimals shared transit (FIX A regression): a bridge-style TRANSIT account carries NO assetId and can
    // hold same-ticker legs at DIFFERENT decimals across chains (USDT 6dp on ETH/Tron, 18dp on BSC). The exact integer
    // base-unit cumulation is INCOMMENSURABLE across scales, so the exact path must NOT be taken for an assetId-less
    // account — the native-float cumulation nets the balanced legs and finds the LATER re-open. Here the bridge opened
    // +100 (6dp) 20d ago, sent −100 (18dp) 19d ago (nets to 0 natively) and re-opened +50 (6dp) 1d ago → residual age
    // 1d < 3d → no alarm. Were the exact path wrongly taken, 1e8 − 1e20 + 5e7 never returns to 0n → openSince pinned to
    // the ancient 20d leg → a FALSE overdue alarm; asserting no alarm proves the exact path is skipped (assetId null).
    it('uses native-float (not exact base units) for an assetId-less mixed-decimals bridge transit (no false alarm)', async () => {
      legStub.transit = [
        {
          id: 7,
          name: 'TRANSIT/bridge/USDT',
          assetId: null,
          native: '50',
          baseUnits: null,
          legCount: '3',
          valuedCount: '3',
        },
      ];
      legStub.transitLegs = [
        { amount: '100', baseUnits: '100000000', bookingDate: Util.daysBefore(20) }, // +100 USDT-ETH (6dp) → 1e8
        { amount: '-100', baseUnits: '-100000000000000000000', bookingDate: Util.daysBefore(19) }, // −100 USDT-BSC (18dp) → −1e20; nets to 0 natively
        { amount: '50', baseUnits: '50000000', bookingDate: Util.daysBefore(1) }, // +50 USDT-ETH (6dp), re-opened 1d ago
      ];

      await service.run();

      expect(mails.some((m) => m.context === MailContext.LEDGER_TRANSIT_OVERDUE)).toBe(false); // float openSince = 1d < 3d
    });

    // §2.3 mixed-decimals shared transit (FIX A): a GENUINELY stuck bridge residual is still flagged. The bridge
    // received +100 USDT-ETH (6dp) 10d ago and never sent it onward (native balance 100, never returns to 0) → residual
    // age 10d > 3d → overdue alarm. Proves the native-float fallback still surfaces a real stuck residual.
    it('flags a genuinely stuck assetId-less bridge transit residual older than the threshold', async () => {
      legStub.transit = [
        {
          id: 9,
          name: 'TRANSIT/bridge/USDT',
          assetId: null,
          native: '100',
          baseUnits: null,
          legCount: '1',
          valuedCount: '1',
        },
      ];
      legStub.transitLegs = [{ amount: '100', baseUnits: '100000000', bookingDate: Util.daysBefore(10) }]; // stuck 10d

      await service.run();

      expect(mails.some((m) => m.context === MailContext.LEDGER_TRANSIT_OVERDUE)).toBe(true); // real residual → alarm
    });

    // F3: a churning transit route that repeatedly opens and closes must be aged from the LAST zero-crossing of its
    // cumulative balance, NOT MIN(bookingDate) over all legs. A route that closed to 0 and re-opened fresh has a YOUNG
    // residual → no overdue alarm, even though its very first leg is ancient (alert-fatigue fix).
    it('ages a churning transit route from the last zero-crossing, not its first leg (F3)', async () => {
      legStub.transit = [{ id: 8, name: 'TRANSIT/payout/CHF', native: '50' }]; // net ≠ 0 → an open candidate
      legStub.transitLegs = [
        { amount: '100', bookingDate: Util.daysBefore(20) }, // opened 20d ago …
        { amount: '-100', bookingDate: Util.daysBefore(19) }, // … closed to 0 the next day (that run ended)
        { amount: '50', bookingDate: Util.daysBefore(1) }, // re-opened fresh 1d ago → residual age = 1d
      ];

      await service.run();

      expect(mails.some((m) => m.context === MailContext.LEDGER_TRANSIT_OVERDUE)).toBe(false); // 1d < 3d threshold
    });

    // Finding 1 / F3 (regression): the residual age comes from ledger_tx.bookingDate — bookingDate lives on ledger_tx,
    // NOT ledger_leg. openResidualSince MUST join leg.tx and select tx.bookingDate; a leg.bookingDate references a
    // non-existent column and crashes EVERY reconciliation run on real PG. Also assert MIN(tx.bookingDate) is gone (F3:
    // no longer an aggregate over ALL legs). Turns red on a dropped leg.tx join or a regression to leg.bookingDate.
    it('reads the residual age from ledger_tx (openResidualSince joins leg.tx + tx.bookingDate, never leg.bookingDate)', async () => {
      const calls = { innerJoins: [] as [string, string][], selects: [] as string[] };
      const qb: any = { _selects: [] as string[] };
      qb.innerJoin = (a: string, b: string) => {
        calls.innerJoins.push([a, b]);
        return qb;
      };
      qb.leftJoin = () => qb; // account.asset leftJoin for the single-asset (MAX(asset.id)) gate
      qb.select = (e: string) => (calls.selects.push(e), qb._selects.push(e), qb);
      qb.addSelect = (e: string) => (calls.selects.push(e), qb._selects.push(e), qb);
      qb.where = () => qb;
      qb.orderBy = () => qb;
      qb.addOrderBy = () => qb;
      qb.groupBy = () => qb;
      qb.addGroupBy = () => qb;
      qb.having = () => qb;
      // the candidate aggregate returns one open account → openResidualSince runs; its per-account query (the one
      // selecting bookingDate) then returns the (empty) leg list
      qb.getRawMany = () =>
        Promise.resolve(
          qb._selects.join(' ').includes('bookingDate') ? [] : [{ id: 9, name: 'TRANSIT/x', native: '5' }],
        );
      jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockReturnValue(qb);

      await (service as any).checkTransitAge(new Date());

      expect(calls.innerJoins).toContainEqual(['leg.tx', 'tx']); // the join that makes tx.bookingDate reachable
      expect(calls.innerJoins).toContainEqual(['leg.account', 'account']);
      expect(calls.selects).toContain('tx.bookingDate'); // age read from ledger_tx
      expect(calls.selects).not.toContain('leg.bookingDate'); // the crashing regression (no such column)
      expect(calls.selects).not.toContain('MIN(tx.bookingDate)'); // F3: no longer an aggregate over ALL legs
    });

    it('emits a suspense alarm when a SUSPENSE balance exceeds its threshold', async () => {
      legStub.suspense = [{ name: 'SUSPENSE', chf: '5000' }];
      // generic SUSPENSE threshold 0 → 5000 > 0 → alarm

      await service.run();

      expect(mails.some((m) => m.context === MailContext.LEDGER_SUSPENSE)).toBe(true);
    });

    // §7.5 line 263: a 'deposit-unrouted' SUSPENSE uses the UNROUTED threshold, NOT the generic one. With the unrouted
    // threshold set ABOVE the balance and the generic threshold 0, a deposit-unrouted balance must be SUPPRESSED while
    // a generic SUSPENSE of the same amount alarms — proving the per-name threshold branch is taken.
    it('applies the deposit-unrouted threshold (not the generic) to a deposit-unrouted SUSPENSE', async () => {
      jest.spyOn(settingService, 'get').mockImplementation((key: string) => {
        if (key === 'ledgerUnroutedDepositThresholdChf') return Promise.resolve('10000'); // high → suppresses
        return Promise.resolve('0'); // generic threshold 0
      });
      legStub.suspense = [
        { name: 'SUSPENSE/Scrypt-deposit-unrouted/EUR', chf: '5000' }, // 5000 < 10000 → suppressed
      ];

      await service.run();

      expect(mails.some((m) => m.context === MailContext.LEDGER_SUSPENSE)).toBe(false); // unrouted threshold applied
    });

    // §7.5 line 266: SUSPENSE balances exist but ALL are within their thresholds → no alarm (the `!alarms.length` exit).
    it('emits no suspense alarm when every SUSPENSE balance is within its threshold', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue('10000'); // both thresholds high
      legStub.suspense = [{ name: 'SUSPENSE', chf: '5000' }]; // 5000 < 10000 → no alarm

      await service.run();

      expect(mails.some((m) => m.context === MailContext.LEDGER_SUSPENSE)).toBe(false);
    });
  });

  describe('equity parity (§7.6)', () => {
    it('computes journalEquity as the signed balance-account sum, no leading minus (R8-1)', async () => {
      // assert the COMPUTED value directly via the private journalEquity() helper (not just a logged string): a leading
      // minus / sign flip (R8-1) or a wrong COALESCE would change this number. The query is disambiguated by its
      // 'account.type IN' where clause in legQb → returns equityChf.
      legStub.equityChf = '16050.005'; // also proves the Util.round(_, 2) on the raw sum
      const journalEquity = await (service as any).journalEquity();
      expect(journalEquity).toBe(16050.01); // round(16050.005, 2), positive (sign-consistent with totalBalanceChf)
    });

    // Finding 2(d): the baseline is the MEDIAN of the last valid snapshots, NOT the single latest one — a lone
    // ±snapshot-skew spike (here 130'000) must NOT move the baseline. Finding 3: the open RefCredit liability is
    // folded into the baseline and reported as its own component. adjustedDifference = journalEquity − (median + refCredit).
    it('compares against the median of the last valid snapshots (spike-immune) and folds in openRefCredit', async () => {
      // last 5 valid totals incl. a transient +130k skew spike → median = 16005 (spike ignored)
      jest
        .spyOn(logService, 'getLatestValidFinancialLogs')
        .mockResolvedValue(validLogs([16000, 130000, 16010, 15990, 16005]));
      jest.spyOn(refRewardService, 'getOpenRefCreditLiability').mockResolvedValue({ amountEur: 38, amountChf: 40 });
      legStub.equityChf = '16050';
      const logSpy = jest.spyOn(service['logger'], 'info');

      await service.run();

      const msg = logSpy.mock.calls.find((c) => c[0].includes('equity parity'))![0] as string;
      const median = Number(/medianTotalBalanceChf (-?\d+(?:\.\d+)?)/.exec(msg)![1]);
      const refCredit = Number(/openRefCreditChf (-?\d+(?:\.\d+)?)/.exec(msg)![1]);
      const adjusted = Number(/adjustedDifference (-?\d+(?:\.\d+)?)/.exec(msg)![1]);
      expect(median).toBe(16005); // median of [15990,16000,16005,16010,130000] — the 130k spike does NOT skew it
      expect(refCredit).toBe(40);
      expect(adjusted).toBe(Util.round(16050 - (16005 + 40), 2)); // journalEquity − (median + refCredit) = 5
      expect(adjusted).toBe(5);

      // threshold defaults to 0 → |5| > 0 → a LEDGER_EQUITY_PARITY alarm with day-key suppression fires
      const alarm = mails.find((m) => m.context === MailContext.LEDGER_EQUITY_PARITY);
      expect(alarm).toBeDefined();
      expect(alarm.type).toBe(MailType.ERROR_MONITORING);
      expect(alarm.correlationId).toContain('ledger-equity-parity-');
      expect(alarm.options?.suppressRecurring).toBe(true);
      const errors = (alarm.input as { errors: string[] }).errors;
      expect(errors.some((e) => e.includes('openRefCreditChf 40'))).toBe(true);
      expect(errors.some((e) => e.includes('adjustedDifference 5'))).toBe(true);
    });

    // Finding 3: a book that differs from the log EXACTLY by the open ref credit is fully explained → adjustedDifference
    // 0 → NO alarm. Without folding in RefCredit the raw difference would be 40 and this would be a permanent false alarm.
    it('does NOT alarm when the book differs from the log solely by the open RefCredit liability', async () => {
      jest.spyOn(logService, 'getLatestValidFinancialLogs').mockResolvedValue(validLogs([16000]));
      jest.spyOn(refRewardService, 'getOpenRefCreditLiability').mockResolvedValue({ amountEur: 38, amountChf: 40 });
      legStub.equityChf = '16040'; // = median(16000) + refCredit(40) → adjustedDifference 0
      const logSpy = jest.spyOn(service['logger'], 'info');

      await service.run();

      expect(mails.some((m) => m.context === MailContext.LEDGER_EQUITY_PARITY)).toBe(false);
      const msg = logSpy.mock.calls.find((c) => c[0].includes('equity parity'))![0] as string;
      expect(Number(/adjustedDifference (-?\d+(?:\.\d+)?)/.exec(msg)![1])).toBe(0);
    });

    // Finding 2(b/c): the alarm is threshold-gated via the 'ledgerEquityParityThresholdChf' runtime setting (analog
    // ledgerSuspenseThresholdChf). A difference within the threshold logs but does NOT alarm.
    it('suppresses the alarm when the adjusted difference is within the runtime threshold', async () => {
      jest.spyOn(settingService, 'get').mockImplementation((key: string) => {
        if (key === 'ledgerEquityParityThresholdChf') return Promise.resolve('100'); // high → suppresses
        return Promise.resolve('0');
      });
      jest.spyOn(logService, 'getLatestValidFinancialLogs').mockResolvedValue(validLogs([16000]));
      jest.spyOn(refRewardService, 'getOpenRefCreditLiability').mockResolvedValue({ amountEur: 0, amountChf: 0 });
      legStub.equityChf = '16050'; // adjustedDifference 50 ≤ threshold 100 → no alarm

      await service.run();

      expect(mails.some((m) => m.context === MailContext.LEDGER_EQUITY_PARITY)).toBe(false);
    });

    it('skips the parity check when there is no valid FinancialDataLog snapshot', async () => {
      jest.spyOn(logService, 'getLatestValidFinancialLogs').mockResolvedValue([]);
      const logSpy = jest.spyOn(service['logger'], 'info');

      await service.run();

      expect(logSpy.mock.calls.find((c) => c[0].includes('equity parity'))).toBeUndefined();
      expect(mails.some((m) => m.context === MailContext.LEDGER_EQUITY_PARITY)).toBe(false);
      expect(refRewardService.getOpenRefCreditLiability).not.toHaveBeenCalled(); // returned before the refCredit read
    });

    it('skips the parity check when every snapshot lacks a totalBalanceChf', async () => {
      const noTotal = Object.assign(new Log(), {
        id: 2,
        created: new Date('2026-06-11T00:00:00Z'),
        valid: true,
        message: JSON.stringify({ assets: {}, tradings: {}, balancesByFinancialType: {}, balancesTotal: {} }),
      });
      jest.spyOn(logService, 'getLatestValidFinancialLogs').mockResolvedValue([noTotal]);
      const logSpy = jest.spyOn(service['logger'], 'info');

      await service.run();

      expect(logSpy.mock.calls.find((c) => c[0].includes('equity parity'))).toBeUndefined();
      expect(mails.some((m) => m.context === MailContext.LEDGER_EQUITY_PARITY)).toBe(false);
    });
  });

  // Finding 4: the native journal↔feed diff is valued in CHF (× mark) BEFORE the CHF-tolerance compare. A native
  // tolerance is ~52'000× too loose for BTC and far too tight for meme-coins. No mark → unverified, never silent 0.
  describe('reconciliation diff unit conversion via mark (§7 / Finding 4)', () => {
    it('alarms on a tiny native BTC diff once valued in CHF (0.001 × 52 000 = 52 CHF > tolerance)', async () => {
      const now = new Date();
      jest
        .spyOn(ledgerAccountRepository, 'find')
        .mockResolvedValue([assetAccount(5, { blockchain: Blockchain.BITCOIN })]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([balance(5, 0, Util.hoursBefore(1, now))]);
      jest.spyOn(markService, 'preload').mockResolvedValue({ getMarkAt: () => 52000 } as any); // BTC mark
      legStub.native = '0.001'; // journal 0.001 vs feed 0 → 0.001 native ≈ 52 CHF

      await service.run();

      const reconMail = mails.find((m) => m.correlationId?.includes('ledger-recon-'));
      expect(reconMail).toBeDefined(); // OLD code: |0.001| ≤ 1 → no alarm (masked a 52 CHF gap); NEW: 52 CHF > 1 → alarm
      const errors = (reconMail.input as { errors: string[] }).errors;
      expect(errors[0]).toContain('52 CHF');
      expect(errors[0]).toContain('@ mark 52000');
    });

    it('does NOT alarm on a large native meme-coin diff worth cents in CHF (1 000 000 × 1e-7 = 0.1 CHF ≤ tolerance)', async () => {
      const now = new Date();
      jest
        .spyOn(ledgerAccountRepository, 'find')
        .mockResolvedValue([assetAccount(5, { blockchain: Blockchain.ETHEREUM })]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([balance(5, 0, Util.hoursBefore(1, now))]);
      jest.spyOn(markService, 'preload').mockResolvedValue({ getMarkAt: () => 0.0000001 } as any); // near-worthless mark
      legStub.native = '1000000'; // journal 1e6 vs feed 0 → 0.1 CHF

      await service.run();

      // OLD code: |1e6| > 1 → false alarm; NEW: 0.1 CHF ≤ 1 → no diff alarm (and it is fresh+marked → not unverified)
      expect(mails.some((m) => m.context === MailContext.LEDGER_RECONCILIATION)).toBe(false);
    });

    it('treats a fresh account with NO mark as unverified (never silently valued at 0)', async () => {
      const now = new Date();
      jest
        .spyOn(ledgerAccountRepository, 'find')
        .mockResolvedValue([assetAccount(5, { blockchain: Blockchain.ETHEREUM })]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([balance(5, 100, Util.hoursBefore(1, now))]);
      jest.spyOn(markService, 'preload').mockResolvedValue({ getMarkAt: () => undefined } as any); // no mark
      legStub.native = '150'; // journal 150 vs feed 100 → would be a diff, but without a mark it can't be valued

      await service.run();

      const unverified = mails.find((m) => m.correlationId?.includes('ledger-unverified-'));
      expect(unverified).toBeDefined();
      expect((unverified.input as { errors: string[] }).errors.some((e) => e.includes('no-mark'))).toBe(true);
      expect(mails.some((m) => m.correlationId?.includes('ledger-recon-'))).toBe(false); // no silent 0-valued diff alarm
    });
  });

  describe('classification + run error branches', () => {
    const now = new Date('2026-06-11T12:00:00Z');

    // §7.1: exchange-blockchain assets are EXCHANGE_ACTIVE — the only exchange class. EXCHANGE_FEEDLESS was removed
    // ("no exchange balance feed" is exactly the generic NO_FEED path) and EXCHANGE_ORDER_DRIVEN too (all configured
    // exchanges refresh their balances every minute, ungated — no objective order-driven criterion exists).
    it('classifies a Kraken-blockchain (exchange) custody as EXCHANGE_ACTIVE (4h threshold)', () => {
      const account = assetAccount(7, { blockchain: Blockchain.KRAKEN });
      const result = service.classifyFeed(balance(7, 100, Util.hoursBefore(2, now)), account, now);
      expect(result.custodyClass).toBe(CustodyClass.EXCHANGE_ACTIVE);
      expect(result.thresholdHours).toBe(4);
      expect(result.status).toBe(FeedStatus.FRESH);
    });

    // §7.1 F3: XT/MEXC belong to the blockchain.enum.ts `// Exchanges` group — the pre-fix KRAKEN/BINANCE-only check
    // misclassified them ON_CHAIN_ACTIVE (same 4h threshold by accident, but the wrong class in every alarm text).
    it('classifies XT- and MEXC-blockchain assets as EXCHANGE_ACTIVE (4h threshold)', () => {
      for (const blockchain of [Blockchain.XT, Blockchain.MEXC]) {
        const result = service.classifyFeed(
          balance(8, 100, Util.hoursBefore(2, now)),
          assetAccount(8, { blockchain }),
          now,
        );
        expect(result.custodyClass).toBe(CustodyClass.EXCHANGE_ACTIVE);
        expect(result.thresholdHours).toBe(4);
        expect(result.status).toBe(FeedStatus.FRESH);
      }
    });

    // §7.1 F3: OLKY_FROZEN is the frozen/dead-bank marker → BANK_DEAD: its feed never refreshes again, so the last
    // snapshot counts for 7d once, then the account is permanently unverified (STALE) — never a 4h on-chain flip.
    it('classifies an OLKY_FROZEN (dead bank) asset as BANK_DEAD (168h threshold, then permanently STALE)', () => {
      const account = assetAccount(9, { blockchain: Blockchain.OLKY_FROZEN });

      const withinWeek = service.classifyFeed(balance(9, 100, Util.hoursBefore(100, now)), account, now);
      expect(withinWeek.custodyClass).toBe(CustodyClass.BANK_DEAD);
      expect(withinWeek.thresholdHours).toBe(7 * 24);
      expect(withinWeek.status).toBe(FeedStatus.FRESH); // 100h < 168h → the last dead-bank snapshot still counts

      const beyondWeek = service.classifyFeed(balance(9, 100, Util.hoursBefore(169, now)), account, now);
      expect(beyondWeek.status).toBe(FeedStatus.STALE); // > 7d → unverified from here on

      const noFeed = service.classifyFeed(undefined, account, now);
      expect(noFeed.status).toBe(FeedStatus.NO_FEED);
      expect(noFeed.custodyClass).toBe(CustodyClass.BANK_DEAD);
    });

    // §7.1 F3: a bank-blockchain asset (blockchain.enum.ts `// Banks` group) WITHOUT a `bank` relation must still get
    // the SEPA/bank threshold — pre-fix it fell through to ON_CHAIN_ACTIVE (4h) and went unverified after 4h.
    it('classifies a bank-blockchain asset without a bank relation as BANK_ACTIVE (96h threshold)', () => {
      const account = assetAccount(10, { blockchain: Blockchain.SUMIXX });
      const result = service.classifyFeed(balance(10, 100, Util.hoursBefore(50, now)), account, now);
      expect(result.custodyClass).toBe(CustodyClass.BANK_ACTIVE);
      expect(result.thresholdHours).toBe(96);
      expect(result.status).toBe(FeedStatus.FRESH); // 50h < 96h
    });

    it('classifies a Frick custody asset without a bank relation as BANK_ACTIVE (96h threshold)', () => {
      const account = assetAccount(11, { blockchain: Blockchain.FRICK });
      const result = service.classifyFeed(balance(11, 100, Util.hoursBefore(50, now)), account, now);
      expect(result.custodyClass).toBe(CustodyClass.BANK_ACTIVE);
      expect(result.thresholdHours).toBe(96);
      expect(result.status).toBe(FeedStatus.FRESH); // 50h < 96h
    });

    it('classifies a no-asset account as ON_CHAIN_INACTIVE (24h default)', () => {
      const account = createCustomLedgerAccount({ id: 1, name: 'x', type: AccountType.ASSET, assetId: 1 } as any);
      const result = service.classifyFeed(balance(1, 100, Util.hoursBefore(2, now)), account, now);
      expect(result.thresholdHours).toBe(24); // ON_CHAIN_INACTIVE (asset undefined)
    });

    // run() no longer wraps reconcile in a try/catch — @DfxCron's lock layer catches + logs (CONTRIBUTING: no
    // redundant try/catch in a @DfxCron method). A reconcile failure therefore propagates out of run() to that layer.
    it('propagates a reconcile error out of run() (handled by @DfxCron, no redundant in-method catch)', async () => {
      jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockRejectedValue(new Error('feed down'));

      await expect(service.run()).rejects.toThrow('feed down');
    });
  });
});
