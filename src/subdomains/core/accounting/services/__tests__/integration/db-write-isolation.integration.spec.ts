import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Util } from 'src/shared/utils/util';
import { LiquidityBalance } from 'src/subdomains/core/liquidity-management/entities/liquidity-balance.entity';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Repository } from 'typeorm';
import { AccountType } from '../../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountRepository } from '../../../repositories/ledger-account.repository';
import { LedgerLegRepository } from '../../../repositories/ledger-leg.repository';
import { BuyFiatConsumer } from '../../consumers/buy-fiat.consumer';
import { CryptoInputConsumer } from '../../consumers/crypto-input.consumer';
import { LedgerBookingJobService } from '../../ledger-booking-job.service';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { LedgerReconciliationService } from '../../ledger-reconciliation.service';
import { InMemoryLedger } from './in-memory-ledger';

const WRITE_METHODS = ['save', 'update', 'insert', 'delete', 'remove', 'upsert', 'softDelete', 'softRemove'] as const;
const ZCHF_WALLET = 200;
const CHF_BANK = 401;
const SETTLED = new Date('2026-06-04T00:00:00Z');
const FRI = new Date('2026-06-05T00:00:00Z');
const SUN = new Date('2026-06-07T00:00:00Z');

/**
 * §10.2 DB-Write-Isolation (Major R3-1 / R9-1 / R12-1) — the dynamic counterpart to the static grep-gate. After a
 * consumer run (and an alarm run), it asserts that NO write method of any business-/log-table repository was
 * invoked, and that only the sanctioned non-ledger_* writes happened: the two ledger Settings (via settingService.set)
 * and the notification queue (via NotificationService.sendMail, R2-Ausnahme-b). Every business table (bank_tx,
 * exchange_tx, payout_order, crypto_input, buy_crypto, buy_fiat, liquidity_management_order, trading_order) PLUS the
 * authoritative `log` table (FinancialDataLog) stay strictly read-only; only ledger_*, the two ledger settings, and
 * notification may change. This catches a write that would slip past the static grep (e.g. via a renamed injection
 * identifier).
 */
describe('Ledger DB-write isolation after a consumer/alarm run (§10.2)', () => {
  let ledger: InMemoryLedger;
  let markService: LedgerMarkService;

  const markMap = new Map([
    [ZCHF_WALLET, [{ created: new Date('2026-01-01'), priceChf: 1 }]],
    [CHF_BANK, [{ created: new Date('2026-01-01'), priceChf: 1 }]],
  ]);

  beforeEach(() => {
    new ConfigService();
    ledger = new InMemoryLedger();
    ledger.seedAsset('Ethereum/ZCHF', 'ZCHF', ZCHF_WALLET);
    ledger.seedAsset('Maerki/CHF', 'CHF', CHF_BANK);
    ledger.seed('ROUNDING', AccountType.ROUNDING, 'CHF');
    markService = createMock<LedgerMarkService>();
    jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(markMap));
  });

  // a source-table repository whose ALL write methods are spied on (must never be called by the consumer)
  function readOnlyRepo<T>(rows: T[]): { repo: Repository<T>; writeSpies: jest.SpyInstance[] } {
    const repo = createMock<Repository<T>>();
    jest.spyOn(repo, 'find').mockResolvedValue(rows as any);
    const writeSpies = WRITE_METHODS.map((m) => jest.spyOn(repo as any, m));
    return { repo, writeSpies };
  }

  function settingService(): { service: SettingService; setKeys: string[] } {
    const service = createMock<SettingService>();
    const setKeys: string[] = [];
    jest.spyOn(service, 'getObj').mockResolvedValue(undefined);
    jest.spyOn(service, 'set').mockImplementation((key: string) => {
      setKeys.push(key);
      return Promise.resolve();
    });
    return { service, setKeys };
  }

  it('books a buy_fiat chain WITHOUT touching any source-table write method (only ledger_* + ledger settings)', async () => {
    const ci = Object.assign(new CryptoInput(), {
      id: 10,
      updated: SETTLED,
      status: PayInStatus.FORWARD_CONFIRMED,
      amount: 15000,
      asset: { id: ZCHF_WALLET, uniqueName: 'Ethereum/ZCHF' },
      buyFiat: { id: 1, amountInChf: 15000 },
    });
    const bf = Object.assign(new BuyFiat(), {
      id: 1,
      updated: SETTLED,
      amountInChf: 15000,
      totalFeeAmountChf: 148.5,
      outputAmount: 14851.5,
      outputReferenceAmount: 14851.5,
      outputAsset: { name: 'CHF' },
      cryptoInput: { id: 10, updated: SETTLED },
      fiatOutput: {
        isTransmittedDate: FRI,
        currency: 'CHF',
        bank: { asset: { id: CHF_BANK } },
        bankTx: { bookingDate: SUN },
      },
    });

    const ciSrc = readOnlyRepo<CryptoInput>([ci]);
    const bfSrc = readOnlyRepo<BuyFiat>([bf]);
    const ciSetting = settingService();
    const bfSetting = settingService();

    await new CryptoInputConsumer(
      ciSetting.service,
      ledger.bookingService,
      ledger.accountService,
      markService,
      ciSrc.repo,
    ).process();
    await new BuyFiatConsumer(
      bfSetting.service,
      ledger.bookingService,
      ledger.accountService,
      markService,
      bfSrc.repo,
      ledger.ledgerTxRepository(),
    ).process();

    // the run actually booked something (otherwise the isolation assertion is vacuous)
    expect(ledger.txs.length).toBeGreaterThan(0);

    // NO write method of the crypto_input / buy_fiat source repos was ever called (strict read-only observer)
    for (const spy of [...ciSrc.writeSpies, ...bfSrc.writeSpies]) {
      expect(spy).not.toHaveBeenCalled();
    }

    // the ONLY non-ledger_* writes are the two ledger watermark settings (sanctioned R2-Ausnahme-a)
    for (const key of [...ciSetting.setKeys, ...bfSetting.setKeys]) {
      expect(key).toMatch(/^ledgerWatermark\.|^ledgerCutoverLogId$/);
    }
  });

  it('keeps the authoritative log table read-only: LogService write methods are never called by a consumer', async () => {
    // the consumer reads marks via LogService.getFinancialLogs only (preload); create/update must never be called
    const logService = createMock<LogService>();
    jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([]);
    const createSpy = jest.spyOn(logService, 'create');
    const updateSpy = jest.spyOn(logService, 'update');

    // a real mark service over the read-only LogService → exercises the genuine getFinancialLogs read path
    const realMarkService = new LedgerMarkService(logService);
    const ci = Object.assign(new CryptoInput(), {
      id: 20,
      updated: SETTLED,
      status: PayInStatus.FORWARD_CONFIRMED,
      amount: 15000,
      asset: { id: ZCHF_WALLET, uniqueName: 'Ethereum/ZCHF' },
      buyFiat: { id: 2, amountInChf: 15000 },
    });
    const ciSrc = readOnlyRepo<CryptoInput>([ci]);

    await new CryptoInputConsumer(
      settingService().service,
      ledger.bookingService,
      ledger.accountService,
      realMarkService,
      ciSrc.repo,
    ).process();

    expect(logService.getFinancialLogs).toHaveBeenCalled(); // the read path was exercised
    expect(createSpy).not.toHaveBeenCalled(); // never written (Hard Constraint #6, the most authoritative table)
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('the only notification write of an alarm run is via NotificationService.sendMail (count grows by N, R12-1)', async () => {
    // model the notification table as a row-count + MAX(id) snapshot (the only sanctioned non-ledger_* "may change"
    // business table besides settings) — sendMail INSERTs exactly one row per alarm (+ post-INSERT UPDATEs on the
    // same row → COUNT grows by N, not "N writes"; Minor R13-1)
    const notification: { id: number }[] = [];
    let nextId = 1;
    const notificationService = createMock<NotificationService>();
    const sendMailSpy = jest.spyOn(notificationService, 'sendMail').mockImplementation((_req: MailRequest) => {
      notification.push({ id: nextId++ }); // INSERT (the post-INSERT updateNotification does not grow the count)
      return Promise.resolve();
    });

    const jobService = createMock<LedgerBookingJobService>();
    jest.spyOn(jobService, 'isLedgerReady').mockResolvedValue(true);
    const liqBalance = createMock<LiquidityManagementBalanceService>();
    const logService = createMock<LogService>();
    jest.spyOn(logService, 'getLatestFinancialLog').mockResolvedValue(undefined);
    const accountRepo = createMock<LedgerAccountRepository>();
    const legRepo = createMock<LedgerLegRepository>();
    const recSetting = createMock<SettingService>();
    jest.spyOn(recSetting, 'get').mockResolvedValue('0');

    // an account whose feed is stale → exactly one aggregated "unverified accounts" alarm
    const now = new Date();
    const account = createCustomLedgerAccount({
      id: 1005,
      name: 'OnChain/5',
      type: AccountType.ASSET,
      assetId: 5,
      asset: Object.assign(new Asset(), { id: 5, blockchain: Blockchain.ETHEREUM }),
    } as any);
    jest.spyOn(accountRepo, 'find').mockResolvedValue([account]);
    jest.spyOn(liqBalance, 'getBalances').mockResolvedValue([
      Object.assign(new LiquidityBalance(), {
        asset: { id: 5 } as Asset,
        amount: 123,
        updated: Util.hoursBefore(10, now),
      }),
    ]);
    const emptyQb: any = {};
    for (const m of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere', 'groupBy', 'addGroupBy', 'having']) {
      emptyQb[m] = () => emptyQb;
    }
    emptyQb.getRawMany = () => Promise.resolve([]);
    emptyQb.getRawOne = () => Promise.resolve({ native: '0', chf: '0' });
    jest.spyOn(legRepo, 'createQueryBuilder').mockReturnValue(emptyQb);

    const service = new LedgerReconciliationService(
      jobService,
      recSetting,
      logService,
      notificationService,
      liqBalance,
      accountRepo,
      legRepo,
    );

    const before = notification.length;
    await service.run();
    const after = notification.length;

    // notification grew by exactly the number of alarms sent (count delta == N sendMail INSERTs)
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    expect(after - before).toBe(1);

    // the feed read happened (the run actually executed) and only via the whitelisted getBalances (no refresh*)
    expect(liqBalance.getBalances).toHaveBeenCalledTimes(1);
    expect(liqBalance.refreshBalances).not.toHaveBeenCalled();
    expect(liqBalance.refreshBankBalance).not.toHaveBeenCalled();
    expect(liqBalance.hasPendingOrders).not.toHaveBeenCalled();
  });

  it('an alarm-free reconciliation run leaves the notification count unchanged', async () => {
    const notification: { id: number }[] = [];
    const notificationService = createMock<NotificationService>();
    jest.spyOn(notificationService, 'sendMail').mockImplementation(() => {
      notification.push({ id: notification.length + 1 });
      return Promise.resolve();
    });

    const jobService = createMock<LedgerBookingJobService>();
    jest.spyOn(jobService, 'isLedgerReady').mockResolvedValue(true);
    const liqBalance = createMock<LiquidityManagementBalanceService>();
    jest.spyOn(liqBalance, 'getBalances').mockResolvedValue([]); // no accounts → no diff, no unverified → no alarm
    const logService = createMock<LogService>();
    jest.spyOn(logService, 'getLatestFinancialLog').mockResolvedValue(undefined);
    const accountRepo = createMock<LedgerAccountRepository>();
    jest.spyOn(accountRepo, 'find').mockResolvedValue([]);
    const legRepo = createMock<LedgerLegRepository>();
    const emptyQb: any = {};
    for (const m of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere', 'groupBy', 'addGroupBy', 'having']) {
      emptyQb[m] = () => emptyQb;
    }
    emptyQb.getRawMany = () => Promise.resolve([]);
    emptyQb.getRawOne = () => Promise.resolve({ native: '0', chf: '0' });
    jest.spyOn(legRepo, 'createQueryBuilder').mockReturnValue(emptyQb);
    const recSetting = createMock<SettingService>();
    jest.spyOn(recSetting, 'get').mockResolvedValue('0');

    const service = new LedgerReconciliationService(
      jobService,
      recSetting,
      logService,
      notificationService,
      liqBalance,
      accountRepo,
      legRepo,
    );

    await service.run();

    expect(notification).toHaveLength(0); // no alarm → no notification write (count unchanged)
  });
});
