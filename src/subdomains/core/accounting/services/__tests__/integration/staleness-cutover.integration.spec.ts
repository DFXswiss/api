import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeTx } from 'src/integration/exchange/entities/exchange-tx.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { LiquidityBalance } from 'src/subdomains/core/liquidity-management/entities/liquidity-balance.entity';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { MailContext } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayoutOrder } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountRepository } from '../../../repositories/ledger-account.repository';
import { LedgerLegRepository } from '../../../repositories/ledger-leg.repository';
import { LedgerAccountService } from '../../ledger-account.service';
import { LedgerBookingJobService } from '../../ledger-booking-job.service';
import { LedgerBookingService, LedgerTxInput } from '../../ledger-booking.service';
import { LedgerBootstrapService } from '../../ledger-bootstrap.service';
import { LedgerCutoverService } from '../../ledger-cutover.service';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { LedgerReconciliationService } from '../../ledger-reconciliation.service';

/**
 * §10.2 evidence-week — the parts that exercise whole-service runs rather than cross-consumer netting:
 * the Class-3 staleness guard (reconciliation run) and the cutover-idempotency (cutover run twice). Both use the
 * REAL service with its source dependencies stubbed (no real DB, no external call). Synthetic data only.
 */
describe('Ledger staleness + cutover integration (§10.2)', () => {
  // --- 4. CLASS-3 STALENESS GUARD --- //

  describe('Class-3 staleness guard (reconciliation run)', () => {
    let service: LedgerReconciliationService;
    let jobService: LedgerBookingJobService;
    let settingService: SettingService;
    let logService: LogService;
    let notificationService: NotificationService;
    let liquidityManagementBalanceService: LiquidityManagementBalanceService;
    let ledgerAccountRepository: LedgerAccountRepository;
    let ledgerLegRepository: LedgerLegRepository;

    let mails: MailRequest[];
    let journalNative: string; // the stubbed journal native balance (journalNativeBalance getRawOne)

    function assetAccount(assetId: number, asset: Partial<Asset>): LedgerAccount {
      return createCustomLedgerAccount({
        id: 1000 + assetId,
        name: `OnChain/${assetId}`,
        type: AccountType.ASSET,
        assetId,
        asset: Object.assign(new Asset(), { id: assetId, ...asset }) as Asset,
      } as any);
    }

    function balance(assetId: number, amount: number, updated: Date): LiquidityBalance {
      return Object.assign(new LiquidityBalance(), { asset: { id: assetId } as Asset, amount, updated });
    }

    // empty leg query-builder stub (transit/suspense/equity all empty for the staleness focus)
    function legQb(): any {
      const qb: any = {};
      for (const m of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere', 'groupBy', 'addGroupBy', 'having']) {
        qb[m] = () => qb;
      }
      qb.getRawMany = () => Promise.resolve([]);
      qb.getRawOne = () => Promise.resolve({ native: journalNative, chf: '0' });
      return qb;
    }

    beforeEach(async () => {
      mails = [];
      journalNative = '0';

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
      jest.spyOn(ledgerLegRepository, 'createQueryBuilder').mockImplementation(() => legQb());
      jest.spyOn(settingService, 'get').mockResolvedValue('0');
      jest.spyOn(logService, 'getLatestFinancialLog').mockResolvedValue(undefined);

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

    it('flags a stale-feed account as unverified with ONE suppressible aggregated alarm (no repeat alarm)', async () => {
      const now = new Date();
      const account = assetAccount(5, { blockchain: Blockchain.ETHEREUM });
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([account]);
      // feed older than the 4h on-chain-active threshold → stale → unverified
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([balance(5, 123, Util.hoursBefore(10, now))]);

      await service.run();

      const unverified = mails.find((m) => m.context === MailContext.LEDGER_RECONCILIATION);
      expect(unverified).toBeDefined();
      // a correlationId + suppressRecurring → NotificationService suppresses the repeat alarm (§7.3 once-per-key/day)
      expect(unverified.correlationId).toBeDefined();
      expect(unverified.options?.suppressRecurring).toBe(true);
    });

    it('treats a 1.0 placeholder feed as never-reconcile (no diff alarm, no unverified spam)', async () => {
      const now = new Date();
      const account = assetAccount(6, { blockchain: Blockchain.ETHEREUM });
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([account]);
      jest.spyOn(liquidityManagementBalanceService, 'getBalances').mockResolvedValue([balance(6, 1.0, now)]);

      await service.run();

      expect(mails).toHaveLength(0); // placeholder → skipped, neither diff nor unverified alarm
    });

    it('does not alarm a fresh on-chain feed that matches the journal (within threshold + tolerance)', async () => {
      const now = new Date();
      journalNative = '100'; // journal == feed → within reconciliation tolerance → no diff alarm
      const account = assetAccount(7, { blockchain: Blockchain.ETHEREUM });
      jest.spyOn(ledgerAccountRepository, 'find').mockResolvedValue([account]);
      jest
        .spyOn(liquidityManagementBalanceService, 'getBalances')
        .mockResolvedValue([balance(7, 100, Util.hoursBefore(2, now))]);

      await service.run();

      expect(mails.find((m) => m.context === MailContext.LEDGER_RECONCILIATION)).toBeUndefined();
    });
  });

  // --- 7. CUTOVER-IDEMPOTENZ --- //

  describe('Cutover idempotency (cutover run twice)', () => {
    let service: LedgerCutoverService;
    let settingService: SettingService;
    let logService: LogService;
    let bootstrapService: LedgerBootstrapService;
    let bookingService: LedgerBookingService;
    let accountService: LedgerAccountService;
    let markService: LedgerMarkService;

    let booked: LedgerTxInput[];
    let cutoverFlag: string | undefined;
    const seqByKey = new Map<string, number>();

    const equity = createCustomLedgerAccount({ id: 99, name: 'EQUITY/opening-balance', type: AccountType.EQUITY });

    function snapshotLog(): Log {
      return Object.assign(new Log(), {
        id: 1557344,
        created: new Date('2026-06-07T22:00:00Z'),
        valid: true,
        message: JSON.stringify({
          assets: { '100': { priceChf: 2, plusBalance: { liquidity: { liquidityBalance: { total: 10 } } } } },
          tradings: {},
          balancesByFinancialType: {},
          balancesTotal: {},
        }),
      });
    }

    beforeEach(async () => {
      booked = [];
      cutoverFlag = undefined;
      seqByKey.clear();

      settingService = createMock<SettingService>();
      logService = createMock<LogService>();
      bootstrapService = createMock<LedgerBootstrapService>();
      bookingService = createMock<LedgerBookingService>();
      accountService = createMock<LedgerAccountService>();
      markService = createMock<LedgerMarkService>();

      // the Setting flag is the primary idempotency guard: set on success, read on the next run
      jest
        .spyOn(settingService, 'get')
        .mockImplementation((key: string) =>
          Promise.resolve(key === 'ledgerCutoverLogId' ? (cutoverFlag as any) : '0'),
        );
      jest.spyOn(settingService, 'set').mockImplementation((key: string, value: string) => {
        if (key === 'ledgerCutoverLogId') cutoverFlag = value;
        return Promise.resolve();
      });
      jest.spyOn(settingService, 'getObj').mockResolvedValue([] as any);

      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog()]);

      // the second guard: UNIQUE-collision-equivalent — a re-booked (sourceType,sourceId,seq) is skipped
      jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
        booked.push(input);
        seqByKey.set(`${input.sourceType}:${input.sourceId}`, input.seq + 1);
        return Promise.resolve({} as any);
      });
      jest
        .spyOn(bookingService, 'nextSeq')
        .mockImplementation((st: string, sid: string) => Promise.resolve(seqByKey.get(`${st}:${sid}`) ?? 0));

      jest.spyOn(accountService, 'findOrCreate').mockImplementation((name: string, type: AccountType) => {
        if (name === 'EQUITY/opening-balance') return Promise.resolve(equity);
        return Promise.resolve(createCustomLedgerAccount({ name, type }));
      });
      jest.spyOn(accountService, 'findByAssetId').mockImplementation((id: number) =>
        Promise.resolve(
          createCustomLedgerAccount({
            id: 1000 + id,
            name: `Asset/${id}`,
            type: AccountType.ASSET,
            assetId: id,
          } as any),
        ),
      );
      jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map()));

      const emptyRepo = () => {
        const repo = createMock<Repository<unknown>>();
        jest.spyOn(repo, 'find').mockResolvedValue([]);
        const maxQb: any = { select: () => maxQb, where: () => maxQb, getRawOne: () => Promise.resolve({ max: 0 }) };
        jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(maxQb);
        return repo;
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          LedgerCutoverService,
          { provide: SettingService, useValue: settingService },
          { provide: LogService, useValue: logService },
          { provide: LedgerBootstrapService, useValue: bootstrapService },
          { provide: LedgerBookingService, useValue: bookingService },
          { provide: LedgerAccountService, useValue: accountService },
          { provide: LedgerMarkService, useValue: markService },
          { provide: getRepositoryToken(BuyFiat), useValue: emptyRepo() },
          { provide: getRepositoryToken(BuyCrypto), useValue: emptyRepo() },
          { provide: getRepositoryToken(BankTx), useValue: emptyRepo() },
          { provide: getRepositoryToken(CryptoInput), useValue: emptyRepo() },
          { provide: getRepositoryToken(ExchangeTx), useValue: emptyRepo() },
          { provide: getRepositoryToken(PayoutOrder), useValue: emptyRepo() },
        ],
      }).compile();

      service = module.get<LedgerCutoverService>(LedgerCutoverService);
    });

    it('runs the full opening once, then the second run is a no-op (Setting flag + UNIQUE backstop)', async () => {
      await service.run();

      expect(bootstrapService.bootstrap).toHaveBeenCalledTimes(1);
      expect(cutoverFlag).toBe('1557344'); // flag set to the used logId
      const firstRunBookings = booked.length;
      expect(firstRunBookings).toBeGreaterThan(0); // at least the ASSET opening
      // opening counter is EQUITY/opening-balance
      expect(booked.some((b) => b.legs.some((l) => l.account.type === AccountType.EQUITY))).toBe(true);

      // SECOND run with the same logId → primary Setting guard returns immediately, nothing re-booked
      await service.run();

      expect(bootstrapService.bootstrap).toHaveBeenCalledTimes(1); // not run again
      expect(booked).toHaveLength(firstRunBookings); // no additional bookings
    });

    it('is idempotent even if the Setting guard is bypassed (UNIQUE-equivalent nextSeq backstop)', async () => {
      await service.run();
      const firstRunBookings = booked.length;

      // simulate a re-run WITHOUT the flag (e.g. flag write lost) — the per-(sourceType,sourceId,seq) nextSeq guard
      // (UNIQUE-collision-equivalent) makes every opening a no-op on the second pass
      cutoverFlag = undefined;
      await service.run();

      expect(booked).toHaveLength(firstRunBookings); // openings skipped via alreadyBooked (nextSeq > seq)
    });
  });
});
