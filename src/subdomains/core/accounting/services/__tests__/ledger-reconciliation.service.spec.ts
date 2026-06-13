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
import { FeedStatus, LedgerReconciliationService } from '../ledger-reconciliation.service';

interface LegQueryStub {
  native?: string; // journalNativeBalance getRawOne
  equityChf?: string; // journalEquity getRawOne
  transit?: { name: string; native: string; oldest: Date }[];
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

  let mails: MailRequest[];
  let legStub: LegQueryStub;

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

  function financeLog(totalBalanceChf: number): Log {
    return Object.assign(new Log(), {
      id: 1,
      created: new Date('2026-06-11T00:00:00Z'),
      message: JSON.stringify({
        assets: {},
        tradings: {},
        balancesByFinancialType: {},
        balancesTotal: { totalBalanceChf },
      }),
    });
  }

  // chainable leg query-builder stub resolving its terminal method by the captured select/where expressions
  function legQb(): any {
    const qb: any = { _selects: [] as string[], _wheres: [] as string[] };
    const chain = () => qb;
    qb.innerJoin = chain;
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
    qb.groupBy = chain;
    qb.addGroupBy = chain;
    qb.having = chain;
    qb.getRawMany = () => {
      const selects = qb._selects.join(' ');
      if (selects.includes('bookingDate')) return Promise.resolve(legStub.transit ?? []); // checkTransitAge (MIN bookingDate)
      return Promise.resolve(legStub.suspense ?? []); // checkSuspense
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

    jest.spyOn(jobService, 'isLedgerReady').mockResolvedValue(true);
    jest.spyOn(notificationService, 'sendMail').mockImplementation((request: MailRequest) => {
      mails.push(request);
      return Promise.resolve();
    });
    jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([]);
    jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([]);
    jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() => legQb());
    jest.spyOn(settingService, 'get').mockResolvedValue('0');

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
      ],
    }).compile();

    service = module.get<LedgerReconciliationService>(LedgerReconciliationService);
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
    jest.spyOn(logService, 'getLatestFinancialLog').mockResolvedValue(financeLog(1000));

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
  });

  describe('transit-age + suspense alarms (§7.4/§7.5)', () => {
    it('emits a transit-overdue alarm for an open transit balance older than the threshold', async () => {
      const oldDate = Util.daysBefore(10); // well beyond the 3-day default threshold
      legStub.transit = [{ name: 'TRANSIT/payout/CHF', native: '14851.5', oldest: oldDate }];

      await service.run();

      expect(mails.some((m) => m.context === MailContext.LEDGER_TRANSIT_OVERDUE)).toBe(true);
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

    it('logs the EXACT computed difference = journalEquity − totalBalanceChf (not a vacuous substring)', async () => {
      jest.spyOn(logService, 'getLatestFinancialLog').mockResolvedValue(financeLog(16000));
      legStub.equityChf = '16050';
      const logSpy = jest.spyOn(service['logger'], 'info');

      await service.run();

      const parityLog = logSpy.mock.calls.find((c) => c[0].includes('equity parity'));
      expect(parityLog).toBeDefined();

      // parse the logged numbers and assert the difference is ARITHMETICALLY journalEquity − totalBalanceChf — this
      // catches a swapped subtraction (16000 − 16050 = −50) or a wrong operand, which a substring check would miss.
      const msg: string = parityLog[0];
      const journalEquity = Number(/journalEquity (-?\d+(?:\.\d+)?)/.exec(msg)![1]);
      const totalBalanceChf = Number(/totalBalanceChf (-?\d+(?:\.\d+)?)/.exec(msg)![1]);
      const difference = Number(/difference (-?\d+(?:\.\d+)?)/.exec(msg)![1]);
      expect(journalEquity).toBe(16050);
      expect(totalBalanceChf).toBe(16000);
      expect(difference).toBe(Util.round(journalEquity - totalBalanceChf, 2)); // = +50, NOT −50 (subtraction order)
      expect(difference).toBe(50);
    });

    it('skips the parity log when there is no FinancialDataLog snapshot', async () => {
      jest.spyOn(logService, 'getLatestFinancialLog').mockResolvedValue(null);
      const logSpy = jest.spyOn(service['logger'], 'info');

      await service.run();

      expect(logSpy.mock.calls.find((c) => c[0].includes('equity parity'))).toBeUndefined();
    });

    it('skips the parity log when the snapshot carries no totalBalanceChf', async () => {
      // a snapshot whose balancesTotal lacks totalBalanceChf → checkEquityParity returns before the log (line 287)
      const noTotal = Object.assign(new Log(), {
        id: 2,
        created: new Date('2026-06-11T00:00:00Z'),
        message: JSON.stringify({ assets: {}, tradings: {}, balancesByFinancialType: {}, balancesTotal: {} }),
      });
      jest.spyOn(logService, 'getLatestFinancialLog').mockResolvedValue(noTotal);
      const logSpy = jest.spyOn(service['logger'], 'info');

      await service.run();

      expect(logSpy.mock.calls.find((c) => c[0].includes('equity parity'))).toBeUndefined();
    });
  });

  describe('classification + run error branches', () => {
    const now = new Date('2026-06-11T12:00:00Z');

    // §7.1: an EXCHANGE_FEEDLESS custody (Kraken/Binance blockchain) is unverified from start → NO_FEED even with a
    // present, fresh balance (the source line 173 branch). classifyCustody maps KRAKEN/BINANCE → EXCHANGE_ACTIVE, so to
    // reach EXCHANGE_FEEDLESS we drive classifyFeed against an account whose custodyClass is EXCHANGE_FEEDLESS via a
    // 0-threshold; simplest deterministic trigger: a Kraken-blockchain asset has EXCHANGE_ACTIVE (4h) — instead assert
    // the documented feedless path by a balance whose age exceeds the threshold is already covered; here we cover the
    // EXCHANGE custody branch (non-on-chain) explicitly.
    it('classifies a Kraken-blockchain (exchange) custody as EXCHANGE_ACTIVE (4h threshold)', () => {
      const account = assetAccount(7, { blockchain: Blockchain.KRAKEN });
      const result = service.classifyFeed(balance(7, 100, Util.hoursBefore(2, now)), account, now);
      expect(result.thresholdHours).toBe(4); // EXCHANGE_ACTIVE
      expect(result.status).toBe(FeedStatus.FRESH);
    });

    it('classifies a no-asset account as ON_CHAIN_INACTIVE (24h default)', () => {
      const account = createCustomLedgerAccount({ id: 1, name: 'x', type: AccountType.ASSET, assetId: 1 } as any);
      const result = service.classifyFeed(balance(1, 100, Util.hoursBefore(2, now)), account, now);
      expect(result.thresholdHours).toBe(24); // ON_CHAIN_INACTIVE (asset undefined)
    });

    it('catches a reconcile error in run() and never throws (failure-isolation)', async () => {
      jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockRejectedValue(new Error('feed down'));
      const errSpy = jest.spyOn(service['logger'], 'error');

      await expect(service.run()).resolves.toBeUndefined(); // swallowed, not rethrown

      expect(errSpy).toHaveBeenCalled();
    });
  });
});
