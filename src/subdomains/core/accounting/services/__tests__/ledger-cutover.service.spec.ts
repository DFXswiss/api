import { createMock } from '@golevelup/ts-jest';
import { CronExpression } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExchangeTx } from 'src/integration/exchange/entities/exchange-tx.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Process } from 'src/shared/services/process.service';
import { DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import { TradingOrder } from 'src/subdomains/core/trading/entities/trading-order.entity';
import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayoutOrder } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerTxInput } from '../ledger-booking.service';
import { LedgerBootstrapService } from '../ledger-bootstrap.service';
import { LedgerCutoverService } from '../ledger-cutover.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';

// synthetic snapshot — structurally equal, NO real customer/account data (public repo)
function snapshotLog(assets: Record<string, unknown>): Log {
  return Object.assign(new Log(), {
    id: 1557344,
    created: new Date('2026-06-07T22:00:00Z'),
    valid: true,
    message: JSON.stringify({ assets, tradings: {}, balancesByFinancialType: {}, balancesTotal: {} }),
  });
}

function buyFiat(values: Partial<BuyFiat>): BuyFiat {
  return Object.assign(new BuyFiat(), {
    id: 1,
    created: new Date('2026-06-01T00:00:00Z'),
    isComplete: false,
    ...values,
  });
}

function buyCrypto(values: Partial<BuyCrypto>): BuyCrypto {
  return Object.assign(new BuyCrypto(), {
    id: 1,
    created: new Date('2026-06-01T00:00:00Z'),
    isComplete: false,
    ...values,
  });
}

describe('LedgerCutoverService', () => {
  let service: LedgerCutoverService;

  let settingService: SettingService;
  let logService: LogService;
  let bootstrapService: LedgerBootstrapService;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let markService: LedgerMarkService;
  let buyFiatRepo: Repository<BuyFiat>;
  let buyCryptoRepo: Repository<BuyCrypto>;
  let bankTxRepo: Repository<BankTx>;
  let bankRepo: Repository<Bank>;
  let bankTxReturnRepo: Repository<BankTxReturn>;
  let bankTxRepeatRepo: Repository<BankTxRepeat>;
  let cryptoInputRepo: Repository<CryptoInput>;
  let exchangeTxRepo: Repository<ExchangeTx>;
  let payoutOrderRepo: Repository<PayoutOrder>;
  let liquidityManagementOrderRepo: Repository<LiquidityManagementOrder>;
  let tradingOrderRepo: Repository<TradingOrder>;
  let liquidityOrderRepo: Repository<LiquidityOrder>;

  let booked: LedgerTxInput[];
  let nextSeqByKey: Map<string, number>;

  const equity = createCustomLedgerAccount({ id: 99, name: 'EQUITY/opening-balance', type: AccountType.EQUITY });

  function assetAccount(assetId: number): LedgerAccount {
    return createCustomLedgerAccount({
      id: 1000 + assetId,
      name: `Asset/${assetId}`,
      type: AccountType.ASSET,
      assetId,
    });
  }

  beforeEach(async () => {
    booked = [];
    nextSeqByKey = new Map();

    settingService = createMock<SettingService>();
    logService = createMock<LogService>();
    bootstrapService = createMock<LedgerBootstrapService>();
    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    markService = createMock<LedgerMarkService>();
    buyFiatRepo = createMock<Repository<BuyFiat>>();
    buyCryptoRepo = createMock<Repository<BuyCrypto>>();
    bankTxRepo = createMock<Repository<BankTx>>();
    bankRepo = createMock<Repository<Bank>>();
    bankTxReturnRepo = createMock<Repository<BankTxReturn>>();
    bankTxRepeatRepo = createMock<Repository<BankTxRepeat>>();
    cryptoInputRepo = createMock<Repository<CryptoInput>>();
    exchangeTxRepo = createMock<Repository<ExchangeTx>>();
    payoutOrderRepo = createMock<Repository<PayoutOrder>>();
    liquidityManagementOrderRepo = createMock<Repository<LiquidityManagementOrder>>();
    tradingOrderRepo = createMock<Repository<TradingOrder>>();
    liquidityOrderRepo = createMock<Repository<LiquidityOrder>>();

    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      booked.push(input);
      return Promise.resolve({} as any);
    });
    jest.spyOn(bookingService, 'nextSeq').mockImplementation((sourceType: string, sourceId: string) => {
      return Promise.resolve(nextSeqByKey.get(`${sourceType}:${sourceId}`) ?? 0);
    });

    jest.spyOn(accountService, 'findOrCreate').mockImplementation((name: string, type: AccountType) => {
      if (name === 'EQUITY/opening-balance') return Promise.resolve(equity);
      return Promise.resolve(createCustomLedgerAccount({ name, type }));
    });
    jest.spyOn(accountService, 'findByAssetId').mockImplementation((id: number) => Promise.resolve(assetAccount(id)));

    // default: no open rows / no manual debt / empty mark cache
    jest.spyOn(buyFiatRepo, 'find').mockResolvedValue([]);
    jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([]);
    jest.spyOn(bankTxRepo, 'find').mockResolvedValue([]);
    jest.spyOn(bankTxReturnRepo, 'find').mockResolvedValue([]);
    jest.spyOn(bankTxRepeatRepo, 'find').mockResolvedValue([]);
    jest.spyOn(bankRepo, 'findOne').mockResolvedValue(null);
    jest.spyOn(settingService, 'getObj').mockResolvedValue([] as any);
    jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map()));

    // watermark MAX(id) query builder stub (chainable where/andWhere for the per-consumer settled filters)
    const maxQb: any = {
      select: () => maxQb,
      where: () => maxQb,
      andWhere: () => maxQb,
      getRawOne: () => Promise.resolve({ max: 0 }),
    };
    for (const repo of [
      bankTxRepo,
      cryptoInputRepo,
      exchangeTxRepo,
      payoutOrderRepo,
      buyCryptoRepo,
      buyFiatRepo,
      liquidityManagementOrderRepo,
      tradingOrderRepo,
      liquidityOrderRepo,
    ]) {
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(maxQb);
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerCutoverService,
        { provide: SettingService, useValue: settingService },
        { provide: LogService, useValue: logService },
        { provide: LedgerBootstrapService, useValue: bootstrapService },
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: LedgerMarkService, useValue: markService },
        { provide: getRepositoryToken(BuyFiat), useValue: buyFiatRepo },
        { provide: getRepositoryToken(BuyCrypto), useValue: buyCryptoRepo },
        { provide: getRepositoryToken(BankTx), useValue: bankTxRepo },
        { provide: getRepositoryToken(Bank), useValue: bankRepo },
        { provide: getRepositoryToken(BankTxReturn), useValue: bankTxReturnRepo },
        { provide: getRepositoryToken(BankTxRepeat), useValue: bankTxRepeatRepo },
        { provide: getRepositoryToken(CryptoInput), useValue: cryptoInputRepo },
        { provide: getRepositoryToken(ExchangeTx), useValue: exchangeTxRepo },
        { provide: getRepositoryToken(PayoutOrder), useValue: payoutOrderRepo },
        { provide: getRepositoryToken(LiquidityManagementOrder), useValue: liquidityManagementOrderRepo },
        { provide: getRepositoryToken(TradingOrder), useValue: tradingOrderRepo },
        { provide: getRepositoryToken(LiquidityOrder), useValue: liquidityOrderRepo },
      ],
    }).compile();

    service = module.get<LedgerCutoverService>(LedgerCutoverService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('runs as @DfxCron (NOT onModuleInit, Major R2-6) with its own LEDGER_CUTOVER kill-switch', () => {
    const params: DfxCronParams = Reflect.getMetadata(DFX_CRONJOB_PARAMS, LedgerCutoverService.prototype.run);
    expect(params.expression).toBe(CronExpression.EVERY_5_MINUTES);
    expect(params.process).toBe(Process.LEDGER_CUTOVER);
  });

  describe('idempotency (Setting primary guard, §6.3)', () => {
    it('is a no-op when ledgerCutoverLogId is already set (double-run = no-op)', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue('1557344');

      await service.run();

      expect(bootstrapService.bootstrap).not.toHaveBeenCalled();
      expect(bookingService.bookTx).not.toHaveBeenCalled();
      expect(settingService.set).not.toHaveBeenCalled();
    });

    it('runs the full sequence when no cutover has happened yet', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);

      await service.run();

      expect(bootstrapService.bootstrap).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure-isolation (§6.3)', () => {
    it('catches a cutover error and never sets the flag (consumers stay no-op)', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      jest.spyOn(logService, 'getFinancialLogs').mockRejectedValue(new Error('boom'));

      await expect(service.run()).resolves.toBeUndefined();

      const flagSet = (settingService.set as jest.Mock).mock.calls.find((c) => c[0] === 'ledgerCutoverLogId');
      expect(flagSet).toBeUndefined();
    });
  });

  describe('opening-balance construction (§6.1)', () => {
    beforeEach(() => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
    });

    it('opens ASSET from liquidityBalance + paymentDeposit + manualLiq + custom (never plusBalance.total)', async () => {
      const snapshot = snapshotLog({
        '100': {
          priceChf: 2,
          plusBalance: {
            total: 9999, // must be ignored (pending phantoms)
            liquidity: { total: 0, liquidityBalance: { total: 10 }, paymentDepositBalance: 3, manualLiqPosition: 1 },
            custom: { total: 1 },
          },
          minusBalance: { total: 0 },
          error: '',
        },
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshot]);

      await service.run();

      const assetTx = booked.find((b) => b.legs.some((l) => l.account.type === AccountType.ASSET));
      expect(assetTx).toBeDefined();
      const assetLeg = assetTx.legs.find((l) => l.account.type === AccountType.ASSET);
      expect(assetLeg.amount).toBe(15); // 10 + 3 + 1 + 1, NOT 9999
      expect(assetLeg.amountChf).toBe(30); // 15 × priceChf 2
      // 2-leg: EQUITY counter = −ASSET CHF → Σ CHF 0 (§6.2)
      const equityLeg = assetTx.legs.find((l) => l.account.type === AccountType.EQUITY);
      expect(equityLeg.amountChf).toBe(-30);
    });

    it('treats a 1.0 placeholder feed as opening 0 (no ASSET leg)', async () => {
      const snapshot = snapshotLog({
        '100': {
          priceChf: 2,
          plusBalance: { total: 5, liquidity: { total: 1, liquidityBalance: { total: 1.0 } } },
          minusBalance: { total: 0 },
          error: '',
        },
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshot]);

      await service.run();

      expect(booked.some((b) => b.legs.some((l) => l.account.type === AccountType.ASSET))).toBe(false);
    });

    it('opens buyFiat-received per row CHF=amountInChf with the synthetic seq0 marker (R4-2)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        // received query: outputAmount IS NULL
        if (where?.outputAmount) return Promise.resolve([buyFiat({ id: 42, amountInChf: 15000, outputAmount: null })]);
        return Promise.resolve([]);
      });

      await service.run();

      const receivedTx = booked.find((b) => b.sourceId === '1557344:buy_fiat:42');
      expect(receivedTx).toBeDefined();
      expect(receivedTx.seq).toBe(0);
      const liabilityLeg = receivedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.account.name).toBe('LIABILITY/buyFiat-received');
      expect(liabilityLeg.amountChf).toBe(-15000); // Cr LIABILITY (CHF-denominated, amountInChf)
    });

    it('opens buyFiat-owed per row CHF = outputAmount × fiat-mark for a foreign-currency (EUR) output (R6-1)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(markService, 'preload')
        .mockResolvedValue(new LedgerMarkCache(new Map([[7, [{ created: new Date('2026-06-01'), priceChf: 0.95 }]]])));
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        // owed query: isComplete false, no outputAmount filter → return the owed row
        if (!where?.outputAmount) {
          return Promise.resolve([buyFiat({ id: 43, outputAmount: 1000, outputAsset: { id: 7, name: 'EUR' } as any })]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      const owedTx = booked.find((b) => b.sourceId === '1557344:buy_fiat-owed:43');
      expect(owedTx).toBeDefined();
      const liabilityLeg = owedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.account.name).toBe('LIABILITY/buyFiat-owed');
      expect(liabilityLeg.amountChf).toBe(-950); // 1000 EUR × 0.95, NOT the raw 1000 (FX basis, R6-1)
    });

    it('opens buyFiat-owed at mark 1 for a CHF output', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) {
          return Promise.resolve([
            buyFiat({ id: 44, outputAmount: 14851.5, outputAsset: { id: 1, name: 'CHF' } as any }),
          ]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      const owedTx = booked.find((b) => b.sourceId === '1557344:buy_fiat-owed:44');
      const liabilityLeg = owedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.amountChf).toBe(-14851.5); // CHF output → mark 1
    });

    it('opens buyCrypto-owed CHF = outputAmount × getMarkAt(outputAsset), needsMark when feedless (R6-1)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) {
          return Promise.resolve([buyCrypto({ id: 50, outputAmount: 2, outputAsset: { id: 999 } as any })]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      const owedTx = booked.find((b) => b.sourceId === '1557344:buy_crypto-owed:50');
      expect(owedTx).toBeDefined();
      const liabilityLeg = owedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.needsMark).toBe(true); // no mark for asset 999 → mark-to-market values later
    });

    // §6.1 (Major design-accounting): an open BANK_TX_RETURN (chargebackBankTx IS NULL) is opened per-row, CHF-valued
    // = amount × bankMark, with the marker the post-cutover chargeback consumer resolves → bankTx-return closes to 0.
    it('opens bankTx-return per row CHF = amount × EUR-mark with the synthetic marker (Major design-accounting)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(markService, 'preload')
        .mockResolvedValue(
          new LedgerMarkCache(new Map([[269, [{ created: new Date('2026-06-01'), priceChf: 0.95 }]]])),
        );
      jest
        .spyOn(bankRepo, 'findOne')
        .mockResolvedValue(Object.assign(new Bank(), { name: 'Olkypay', currency: 'EUR', asset: { id: 269 } }) as any);
      jest.spyOn(bankTxReturnRepo, 'find').mockResolvedValue([
        Object.assign(new BankTxReturn(), {
          bankTx: Object.assign(new BankTx(), { id: 70, amount: 100, accountIban: 'EUR-IBAN', currency: 'EUR' }),
        }),
      ] as any);

      await service.run();

      const returnTx = booked.find((b) => b.sourceId === '1557344:bank_tx-return:70');
      expect(returnTx).toBeDefined();
      expect(returnTx.seq).toBe(0);
      const liabilityLeg = returnTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.account.name).toBe('LIABILITY/bankTx-return');
      expect(liabilityLeg.amountChf).toBe(-95); // 100 EUR × 0.95, NOT the raw 100 (CHF-denominated §3.4)
    });

    // §6.1: an open BANK_TX_REPEAT (chargebackBankTx IS NULL) on a CHF bank → mark 1, marker bank_tx-repeat
    it('opens bankTx-repeat per row at mark 1 for a CHF bank', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(bankRepo, 'findOne')
        .mockResolvedValue(Object.assign(new Bank(), { name: 'Yapeal', currency: 'CHF', asset: { id: 100 } }) as any);
      jest.spyOn(bankTxRepeatRepo, 'find').mockResolvedValue([
        Object.assign(new BankTxRepeat(), {
          bankTx: Object.assign(new BankTx(), { id: 80, amount: 250, accountIban: 'CHF-IBAN', currency: 'CHF' }),
        }),
      ] as any);

      await service.run();

      const repeatTx = booked.find((b) => b.sourceId === '1557344:bank_tx-repeat:80');
      expect(repeatTx).toBeDefined();
      const liabilityLeg = repeatTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.account.name).toBe('LIABILITY/bankTx-repeat');
      expect(liabilityLeg.amountChf).toBe(-250); // CHF bank → mark 1
    });

    // §6.1: open unattributed credits (GSheet/Pending/Unknown/NULL CRDT) are opened AGGREGATED, CHF = Σ(amount × mark)
    it('opens an aggregated LIABILITY/unattributed from open bank_tx credits (Major design-accounting)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(markService, 'preload')
        .mockResolvedValue(
          new LedgerMarkCache(new Map([[269, [{ created: new Date('2026-06-01'), priceChf: 0.95 }]]])),
        );
      jest
        .spyOn(bankRepo, 'findOne')
        .mockResolvedValue(Object.assign(new Bank(), { name: 'Olkypay', currency: 'EUR', asset: { id: 269 } }) as any);
      // first find() = typed credits (GSheet/Pending/Unknown), second find() = NULL-type credits
      jest
        .spyOn(bankTxRepo, 'find')
        .mockResolvedValueOnce([
          Object.assign(new BankTx(), { id: 90, amount: 1000, accountIban: 'EUR-IBAN', currency: 'EUR' }),
        ] as any)
        .mockResolvedValueOnce([
          Object.assign(new BankTx(), { id: 91, amount: 2000, accountIban: 'EUR-IBAN', currency: 'EUR' }),
        ] as any);

      await service.run();

      const unattributedTx = booked.find((b) => b.sourceId === '1557344:unattributed');
      expect(unattributedTx).toBeDefined();
      const liabilityLeg = unattributedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.account.name).toBe('LIABILITY/unattributed');
      expect(liabilityLeg.amountChf).toBe(-2850); // (1000 + 2000) × 0.95, aggregated, CHF-denominated
    });
  });

  describe('watermark init + flag last (§6.3 Blocker R3-1)', () => {
    it('initialises every consumer watermark and sets ledgerCutoverLogId LAST', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await service.run();

      const keys = setSpy.mock.calls.map((c) => c[0]);
      expect(keys).toContain('ledgerWatermark.bank_tx');
      expect(keys).toContain('ledgerWatermark.crypto_input');
      expect(keys).toContain('ledgerWatermark.buy_fiat');
      expect(keys).toContain('ledgerWatermark.buy_crypto');
      expect(keys).toContain('ledgerWatermark.exchange_tx');
      expect(keys).toContain('ledgerWatermark.payout_order');
      // §6.3 Z.910-917 / Blocker R3-1: the three on-chain/LM/trading sources MUST be initialised too — a missing
      // watermark would default to lastProcessedId:0 → full-history backfill + ASSET double-count vs openAssets
      expect(keys).toContain('ledgerWatermark.liquidity_management_order');
      expect(keys).toContain('ledgerWatermark.trading_order');
      expect(keys).toContain('ledgerWatermark.liquidity_order');

      // flag is set LAST — the atomic "ledger ready" marker (§6.3 step 5)
      expect(keys[keys.length - 1]).toBe('ledgerCutoverLogId');
      expect(setSpy).toHaveBeenLastCalledWith('ledgerCutoverLogId', '1557344');
    });

    it('writes watermarks with lastReversalScan = snapshotDate', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await service.run();

      const bankWm = setSpy.mock.calls.find((c) => c[0] === 'ledgerWatermark.bank_tx');
      expect(JSON.parse(bankWm[1]).lastReversalScan).toBe('2026-06-07T22:00:00.000Z');
    });

    // §6.3 Z.917 / Blocker R3-1: the per-consumer settled-filter MUST be applied to the watermark MAX(id) query,
    // otherwise a high-id pre-cutover NON-settled row sets the watermark too high (payout_order: skips a later
    // Complete-transition → phantom liability) / too low (exchange_tx: re-books a row the ASSET-opening already
    // covers → double-count). This asserts the filter predicate, not just the key existence.
    it('applies the settled-status filter so a non-settled high-id row does NOT set the watermark', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      // a query builder that records the andWhere status-filter and returns MAX(id) only over rows matching it:
      // row {id:200, status:notSettled} (high id) + row {id:50, status:settled} → filtered MAX = 50.
      const filteredQb = (settledValue: string) => {
        const rows = [
          { id: 200, status: 'notSettled' },
          { id: 50, status: settledValue },
        ];
        let statusPredicate: ((s: string) => boolean) | undefined;
        const qb: any = {
          select: () => qb,
          where: () => qb,
          andWhere: (clause: string, params: Record<string, unknown>) => {
            // capture the status predicate from the consumer-specific filter (= :poStatus / = :etStatus)
            const match = /e\.status\s*=\s*:(\w+)/.exec(clause);
            if (match) {
              const expected = params[match[1]];
              statusPredicate = (s: string) => s === expected;
            }
            return qb;
          },
          getRawOne: () => {
            const matching = rows.filter((r) => (statusPredicate ? statusPredicate(r.status) : true));
            const max = matching.length ? Math.max(...matching.map((r) => r.id)) : null;
            return Promise.resolve({ max });
          },
        };
        return qb;
      };

      jest.spyOn(payoutOrderRepo, 'createQueryBuilder').mockReturnValue(filteredQb('Complete') as any);
      jest.spyOn(exchangeTxRepo, 'createQueryBuilder').mockReturnValue(filteredQb('ok') as any);

      await service.run();

      const payoutWm = setSpy.mock.calls.find((c) => c[0] === 'ledgerWatermark.payout_order');
      const exchangeWm = setSpy.mock.calls.find((c) => c[0] === 'ledgerWatermark.exchange_tx');
      expect(JSON.parse(payoutWm[1]).lastProcessedId).toBe(50); // NOT 200 → filter applied
      expect(JSON.parse(exchangeWm[1]).lastProcessedId).toBe(50); // NOT 200 → filter applied
    });

    // maxSettledId fallbacks (lines 638-640): getRawOne returning `undefined` (→ `?? { max: null }`) and a row whose
    // MAX(id) is NULL (no matching rows → `max ?? 0` → 0). Both must yield lastProcessedId 0 (no row to anchor on),
    // never NaN/undefined in the persisted watermark.
    it('writes lastProcessedId 0 when the MAX(id) query returns null or undefined (no settled rows)', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      const nullMaxQb: any = { select: () => nullMaxQb, where: () => nullMaxQb, andWhere: () => nullMaxQb };
      nullMaxQb.getRawOne = () => Promise.resolve({ max: null }); // max ?? 0 → 0
      const undefinedRawQb: any = {
        select: () => undefinedRawQb,
        where: () => undefinedRawQb,
        andWhere: () => undefinedRawQb,
      };
      undefinedRawQb.getRawOne = () => Promise.resolve(undefined); // (await …) ?? { max: null } → { max: null } → 0

      jest.spyOn(payoutOrderRepo, 'createQueryBuilder').mockReturnValue(nullMaxQb);
      jest.spyOn(exchangeTxRepo, 'createQueryBuilder').mockReturnValue(undefinedRawQb);

      await service.run();

      const payoutWm = setSpy.mock.calls.find((c) => c[0] === 'ledgerWatermark.payout_order');
      const exchangeWm = setSpy.mock.calls.find((c) => c[0] === 'ledgerWatermark.exchange_tx');
      expect(JSON.parse(payoutWm[1]).lastProcessedId).toBe(0); // MAX null → 0
      expect(JSON.parse(exchangeWm[1]).lastProcessedId).toBe(0); // getRawOne undefined → { max: null } → 0
    });
  });

  // --- SNAPSHOT SELECTION + PINNING (§6.3 / Major design-accounting R3-1) --- //

  describe('snapshot selection + pinning (R3-1)', () => {
    it('throws (caught by run) when there is no valid FinancialDataLog snapshot ≤ Stichtag', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      // selectSnapshot reads getFinancialLogs and keeps only rows created ≤ now; a single FUTURE-dated row is filtered
      // out → no snapshot → cutover throws → run() catches it → flag stays unset.
      const future = Object.assign(new Log(), { id: 1, created: new Date(Date.now() + 86400000), valid: true });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([future]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await expect(service.run()).resolves.toBeUndefined();

      expect(bookingService.bookTx).not.toHaveBeenCalled();
      expect(setSpy.mock.calls.find((c) => c[0] === 'ledgerCutoverLogId')).toBeUndefined();
    });

    it('reuses the PINNED snapshot logId on a re-run (stable sourceIds → idempotent re-book)', async () => {
      // a previous partial run pinned snapshot logId 999 → the re-run must reuse exactly logId 999, NOT re-select the
      // newest log (which would drift the per-row opening sourceIds and double-count, R3-1).
      jest.spyOn(settingService, 'get').mockImplementation((key: string) => {
        if (key === 'ledgerCutoverSnapshotLogId') return Promise.resolve('999');
        return Promise.resolve(undefined); // ledgerCutoverLogId unset → cutover proceeds
      });
      const pinned = Object.assign(new Log(), {
        id: 999,
        created: new Date('2026-06-07T22:00:00Z'),
        valid: true,
        message: JSON.stringify({ assets: {}, tradings: {}, balancesByFinancialType: {}, balancesTotal: {} }),
      });
      const getLogSpy = jest.spyOn(logService, 'getLog').mockResolvedValue(pinned);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await service.run();

      expect(getLogSpy).toHaveBeenCalledWith(999); // reused the pinned id, NOT a fresh selection
      // the flag is set to the pinned logId (auditable: value = the reused snapshot id)
      expect(setSpy).toHaveBeenLastCalledWith('ledgerCutoverLogId', '999');
    });

    it('throws (caught) when the pinned snapshot log no longer exists', async () => {
      jest.spyOn(settingService, 'get').mockImplementation((key: string) => {
        if (key === 'ledgerCutoverSnapshotLogId') return Promise.resolve('999');
        return Promise.resolve(undefined);
      });
      jest.spyOn(logService, 'getLog').mockResolvedValue(null); // pinned log was deleted
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await expect(service.run()).resolves.toBeUndefined(); // run swallows the throw

      expect(setSpy.mock.calls.find((c) => c[0] === 'ledgerCutoverLogId')).toBeUndefined(); // flag never set
    });

    it('pins the freshly-selected snapshot before booking any opening (set-only-if-unset)', async () => {
      // no pin yet → selectSnapshot picks the newest valid log; pinnedSnapshot writes the pin BEFORE any opening tx.
      const snapshot = snapshotLog({});
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined); // both keys unset
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshot]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await service.run();

      const pinCall = setSpy.mock.calls.find((c) => c[0] === 'ledgerCutoverSnapshotLogId');
      expect(pinCall).toBeDefined();
      expect(pinCall[1]).toBe('1557344'); // the selected snapshot id is pinned
    });

    it('honours a concurrent pin: a different logId won under the set-only-if-unset re-read → uses that one', async () => {
      // selectSnapshot picks snapshot 1557344, but between the set and the re-read a concurrent runner pinned 888.
      // The re-read returns 888 (≠ the selected id) → pinnedSnapshot resolves logId 888 via getLog and uses it.
      const concurrentLog = Object.assign(new Log(), {
        id: 888,
        created: new Date('2026-06-07T21:00:00Z'),
        valid: true,
        message: JSON.stringify({ assets: {}, tradings: {}, balancesByFinancialType: {}, balancesTotal: {} }),
      });
      let pinReads = 0;
      jest.spyOn(settingService, 'get').mockImplementation((key: string) => {
        if (key === 'ledgerCutoverLogId') return Promise.resolve(undefined);
        if (key === 'ledgerCutoverSnapshotLogId') {
          pinReads++;
          // first read (the set-only-if-unset guard) = unset → it sets; the re-read returns the concurrent 888
          return Promise.resolve(pinReads <= 1 ? undefined : '888');
        }
        return Promise.resolve(undefined);
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      const getLogSpy = jest.spyOn(logService, 'getLog').mockResolvedValue(concurrentLog);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await service.run();

      expect(getLogSpy).toHaveBeenCalledWith(888); // the concurrent pin won → its log is loaded
      expect(setSpy).toHaveBeenLastCalledWith('ledgerCutoverLogId', '888'); // flag set to the concurrent winner
    });

    it('throws (caught) when the snapshot message is not parseable JSON', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      const broken = Object.assign(new Log(), {
        id: 1557344,
        created: new Date('2026-06-07T22:00:00Z'),
        valid: true,
        message: '{ not valid json',
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([broken]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await expect(service.run()).resolves.toBeUndefined();

      expect(bookingService.bookTx).not.toHaveBeenCalled();
      expect(setSpy.mock.calls.find((c) => c[0] === 'ledgerCutoverLogId')).toBeUndefined();
    });
  });

  // --- ADDITIONAL OPENING BRANCHES (§6.1) --- //

  describe('further opening branches (§6.1)', () => {
    beforeEach(() => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
    });

    it('skips an ASSET whose asset is not in the CoA (findByAssetId → undefined)', async () => {
      const snapshot = snapshotLog({
        '100': {
          priceChf: 2,
          plusBalance: { total: 5, liquidity: { total: 5, liquidityBalance: { total: 5 } } },
          minusBalance: { total: 0 },
          error: '',
        },
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshot]);
      jest.spyOn(accountService, 'findByAssetId').mockResolvedValue(undefined); // asset not in the CoA

      await service.run();

      expect(booked.some((b) => b.legs.some((l) => l.account.type === AccountType.ASSET))).toBe(false);
    });

    it('opens an ASSET with needsMark when priceChf is non-finite (feedless → mark-to-market values later)', async () => {
      const snapshot = snapshotLog({
        '100': {
          priceChf: NaN, // non-finite → no CHF valuation now → needsMark
          plusBalance: { total: 5, liquidity: { total: 5, liquidityBalance: { total: 5 } } },
          minusBalance: { total: 0 },
          error: '',
        },
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshot]);

      await service.run();

      const assetTx = booked.find((b) => b.legs.some((l) => l.account.type === AccountType.ASSET));
      const assetLeg = assetTx.legs.find((l) => l.account.type === AccountType.ASSET);
      expect(assetLeg.amount).toBe(5); // native opening still booked
      expect(assetLeg.needsMark).toBe(true); // feedless → no CHF, valued by mark-to-market
      expect(assetLeg.amountChf).toBeUndefined();
    });

    it('skips a buyFiat-received row whose amountInChf is null (no CHF anchor → no leg)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (where?.outputAmount) return Promise.resolve([buyFiat({ id: 42, amountInChf: null, outputAmount: null })]);
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat:42')).toBe(false);
    });

    it('opens buyCrypto-received per row CHF = amountInChf and skips a row with null amountInChf', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        // received query: outputAmount IS NULL → one bookable row (id 60) + one null-amountInChf row (id 61, skipped)
        if (where?.outputAmount) {
          return Promise.resolve([
            buyCrypto({ id: 60, amountInChf: 15000, outputAmount: null }),
            buyCrypto({ id: 61, amountInChf: null, outputAmount: null }),
          ]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      const receivedTx = booked.find((b) => b.sourceId === '1557344:buy_crypto:60');
      expect(receivedTx).toBeDefined();
      const liabilityLeg = receivedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.account.name).toBe('LIABILITY/buyCrypto-received');
      expect(liabilityLeg.amountChf).toBe(-15000);
      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto:61')).toBe(false); // null amountInChf → skipped
    });

    it('skips a bankTx-return row whose underlying bank_tx amount is null (nothing to anchor)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(bankTxReturnRepo, 'find').mockResolvedValue([
        Object.assign(new BankTxReturn(), {
          bankTx: Object.assign(new BankTx(), { id: 70, amount: null, accountIban: 'CHF-IBAN', currency: 'CHF' }),
        }),
      ] as any);

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:bank_tx-return:70')).toBe(false);
    });

    it('opens an aggregated unattributed with needsMark when a credit cannot be valued (no mark)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      // no mark in the cache + the bank match resolves to an EUR bank whose asset has no mark → mark == null → needsMark
      jest
        .spyOn(bankRepo, 'findOne')
        .mockResolvedValue(Object.assign(new Bank(), { name: 'Olkypay', currency: 'EUR', asset: { id: 269 } }) as any);
      jest
        .spyOn(bankTxRepo, 'find')
        .mockResolvedValueOnce([
          Object.assign(new BankTx(), { id: 90, amount: 1000, accountIban: 'EUR-IBAN', currency: 'EUR' }),
        ] as any)
        .mockResolvedValueOnce([]);

      await service.run();

      const unattributedTx = booked.find((b) => b.sourceId === '1557344:unattributed');
      expect(unattributedTx).toBeDefined();
      const liabilityLeg = unattributedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.needsMark).toBe(true); // a feedless credit → needsMark, valued later by mark-to-market
      expect(liabilityLeg.amountChf).toBeUndefined();
    });

    it('skips an unattributed credit row with a null amount (no opening when nothing else valued)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(bankTxRepo, 'find')
        .mockResolvedValueOnce([
          Object.assign(new BankTx(), { id: 90, amount: null, accountIban: 'CHF-IBAN', currency: 'CHF' }),
        ] as any)
        .mockResolvedValueOnce([]);

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:unattributed')).toBe(false); // amountChf 0 + no needsMark → none
    });

    it('values an unattributed credit at mark 1 via the bankTx.currency=CHF fast-path (no bank row needed)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(bankRepo, 'findOne').mockResolvedValue(null); // no Bank row, but the tx itself is CHF → mark 1
      jest
        .spyOn(bankTxRepo, 'find')
        .mockResolvedValueOnce([
          Object.assign(new BankTx(), { id: 90, amount: 500, accountIban: 'CHF-IBAN', currency: 'CHF' }),
        ] as any)
        .mockResolvedValueOnce([]);

      await service.run();

      const unattributedTx = booked.find((b) => b.sourceId === '1557344:unattributed');
      expect(unattributedTx).toBeDefined();
      const liabilityLeg = unattributedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.amountChf).toBe(-500); // CHF → mark 1, NOT needsMark
    });

    // §6.1 openBuyFiatOwed: a row with outputAmount NULL is skipped (no owed value to anchor) — line 292
    it('skips a buyFiat-owed row whose outputAmount is null (nothing to anchor)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) return Promise.resolve([buyFiat({ id: 50, outputAmount: null })]);
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-owed:50')).toBe(false);
    });

    // §6.1 openBuyFiatOwed: a foreign-currency (EUR) output whose fiat-mark is missing is skipped — line 296
    // (cannot value the CHF-denominated owed liability now; the forward path values it later).
    it('skips a foreign-currency buyFiat-owed row when its fiat-mark is missing (no value)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map())); // no mark for asset 7
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) {
          return Promise.resolve([buyFiat({ id: 51, outputAmount: 1000, outputAsset: { id: 7, name: 'EUR' } as any })]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-owed:51')).toBe(false); // no fiat-mark → skipped
    });

    // fiatMark (line 719 `assetId != null` false side): a foreign-currency buyFiat-owed whose outputAsset has NO id →
    // fiatMark(undefined, …) returns undefined → the row is skipped (cannot value the owed liability).
    it('skips a foreign-currency buyFiat-owed row whose outputAsset has no id (fiatMark undefined)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) {
          // outputAsset.name 'EUR' (not CHF) but id undefined → fiatMark(undefined) → undefined → skip
          return Promise.resolve([buyFiat({ id: 53, outputAmount: 1000, outputAsset: { name: 'EUR' } as any })]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-owed:53')).toBe(false);
    });

    // §6.1 openBuyCryptoOwed: a row WITH a mark for its outputAsset → CHF = outputAmount × mark (line 350 valued side,
    // the complement of the feedless needsMark test).
    it('opens a buyCrypto-owed at CHF = outputAmount × mark when the outputAsset is feeded', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(markService, 'preload')
        .mockResolvedValue(
          new LedgerMarkCache(new Map([[42, [{ created: new Date('2026-06-01'), priceChf: 30000 }]]])),
        );
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) {
          return Promise.resolve([buyCrypto({ id: 54, outputAmount: 0.5, outputAsset: { id: 42 } as any })]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      const owedTx = booked.find((b) => b.sourceId === '1557344:buy_crypto-owed:54');
      expect(owedTx).toBeDefined();
      const liabilityLeg = owedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.amountChf).toBe(-15000); // 0.5 × 30000, NOT needsMark
      expect(liabilityLeg.needsMark).toBe(false);
    });

    // §6.1 openBuyCryptoOwed line 349 (`outputAsset?.id != null` FALSE side): an owed row whose outputAsset has NO id
    // → mark undefined → needsMark opening (valued later by mark-to-market). Distinct from the id-present-no-mark case.
    it('opens a buyCrypto-owed with needsMark when the outputAsset has no id (line 349 null-id side)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) {
          return Promise.resolve([buyCrypto({ id: 55, outputAmount: 2, outputAsset: {} as any })]); // no id
        }
        return Promise.resolve([]);
      });

      await service.run();

      const owedTx = booked.find((b) => b.sourceId === '1557344:buy_crypto-owed:55');
      expect(owedTx).toBeDefined();
      const liabilityLeg = owedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.needsMark).toBe(true); // no outputAsset.id → no mark → needsMark
      expect(liabilityLeg.amountChf).toBeUndefined();
    });

    // §6.1 openBuyCryptoOwed: a row with outputAmount NULL is skipped — line 347
    it('skips a buyCrypto-owed row whose outputAmount is null', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) return Promise.resolve([buyCrypto({ id: 52, outputAmount: null })]);
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto-owed:52')).toBe(false);
    });

    // §6.1 openOpenLiabilityRow (bankTx-return/repeat): a row with a valid amount but NO mark → needsMark, amountChf
    // undefined (line 423 undefined side). EUR bank, empty mark cache → mark undefined → the liability leg is feedless.
    it('opens a bankTx-return with needsMark when the bank mark is missing (line 423 undefined side)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map())); // no EUR mark
      jest
        .spyOn(bankRepo, 'findOne')
        .mockResolvedValue(Object.assign(new Bank(), { name: 'Olkypay', currency: 'EUR', asset: { id: 269 } }) as any);
      jest.spyOn(bankTxReturnRepo, 'find').mockResolvedValue([
        Object.assign(new BankTxReturn(), {
          bankTx: Object.assign(new BankTx(), { id: 95, amount: 400, accountIban: 'EUR-IBAN', currency: 'EUR' }),
        }),
      ] as any);

      await service.run();

      const returnTx = booked.find((b) => b.sourceId === '1557344:bank_tx-return:95');
      expect(returnTx).toBeDefined();
      const liabilityLeg = returnTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.needsMark).toBe(true); // EUR + no mark → feedless, valued later
      expect(liabilityLeg.amountChf).toBeUndefined();
    });

    // §4.2/§1.6 bankMark: a bank_tx with NO accountIban (line 489 null side) and currency EUR → no bank lookup, no
    // asset → mark undefined → the unattributed leg is needsMark.
    it('values an unattributed credit needsMark when the bank_tx has no accountIban and no CHF currency', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map()));
      jest
        .spyOn(bankTxRepo, 'find')
        .mockResolvedValueOnce([
          Object.assign(new BankTx(), { id: 96, amount: 700, accountIban: null, currency: 'EUR' }), // no iban → no bank
        ] as any)
        .mockResolvedValueOnce([]);

      await service.run();

      const unattributedTx = booked.find((b) => b.sourceId === '1557344:unattributed');
      expect(unattributedTx).toBeDefined();
      const liabilityLeg = unattributedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.needsMark).toBe(true); // no accountIban, EUR, no mark → needsMark
    });

    // §4.2/§1.6 bankMark: a bank match whose asset is undefined (line 495 `asset?.id != null` false side) and a
    // non-CHF currency → mark undefined → needsMark.
    it('values an unattributed credit needsMark when the matched bank has no asset', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map()));
      jest
        .spyOn(bankRepo, 'findOne')
        .mockResolvedValue(Object.assign(new Bank(), { name: 'Olkypay', currency: 'EUR', asset: undefined }) as any);
      jest
        .spyOn(bankTxRepo, 'find')
        .mockResolvedValueOnce([
          Object.assign(new BankTx(), { id: 97, amount: 800, accountIban: 'EUR-IBAN', currency: 'EUR' }),
        ] as any)
        .mockResolvedValueOnce([]);

      await service.run();

      const unattributedTx = booked.find((b) => b.sourceId === '1557344:unattributed');
      expect(unattributedTx).toBeDefined();
      const liabilityLeg = unattributedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.needsMark).toBe(true); // bank has no asset → no mark → needsMark
    });
  });

  // --- MANUAL DEBT OPENING (§6.1 D15 C.f) --- //

  describe('manual-debt opening (§6.1)', () => {
    beforeEach(() => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
    });

    it('opens a manual-debt liability per position CHF = priceChf × value (Dr EQUITY / Cr LIABILITY/manual-debt)', async () => {
      const snapshot = snapshotLog({ '100': { priceChf: 2 } });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshot]);
      jest.spyOn(settingService, 'getObj').mockResolvedValue([{ assetId: 100, value: 1000 }] as any); // one debt position

      await service.run();

      const manualTx = booked.find((b) => b.sourceId === '1557344:manual-debt:100');
      expect(manualTx).toBeDefined();
      const liabilityLeg = manualTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.account.name).toBe('LIABILITY/manual-debt');
      expect(liabilityLeg.amountChf).toBe(-2000); // −(priceChf 2 × value 1000), the debt side only (Minor R6-5)
      const equityLeg = manualTx.legs.find((l) => l.account.type === AccountType.EQUITY);
      expect(equityLeg.amountChf).toBe(2000); // Dr EQUITY/opening-balance counter
    });

    it('skips a manual-debt position with no value (seq advances, no leg)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({ '100': { priceChf: 2 } })]);
      jest.spyOn(settingService, 'getObj').mockResolvedValue([
        { assetId: 100, value: 0 }, // no value → skipped
        { assetId: 100, value: 500 }, // bookable → seq must be 1 (the skipped position advanced seq)
      ] as any);

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:manual-debt:100' && b.seq === 0)).toBe(false); // skipped at seq0
      const booked1 = booked.find((b) => b.sourceId === '1557344:manual-debt:100' && b.seq === 1);
      expect(booked1).toBeDefined();
      expect(booked1.legs.find((l) => l.account.type === AccountType.LIABILITY).amountChf).toBe(-1000);
    });

    it('opens a manual-debt with needsMark + native fallback when the asset priceChf is non-finite', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({ '100': { priceChf: NaN } })]);
      jest.spyOn(settingService, 'getObj').mockResolvedValue([{ assetId: 100, value: 1000 }] as any);

      await service.run();

      const manualTx = booked.find((b) => b.sourceId === '1557344:manual-debt:100');
      expect(manualTx).toBeDefined();
      const liabilityLeg = manualTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.needsMark).toBe(true);
      expect(liabilityLeg.amount).toBe(-1000); // native fallback −value (no CHF basis yet)
      expect(liabilityLeg.amountChf).toBeUndefined();
    });

    it('books no manual-debt opening when there are no debt positions', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(settingService, 'getObj').mockResolvedValue([] as any);

      await service.run();

      expect(booked.some((b) => b.sourceId?.startsWith('1557344:manual-debt'))).toBe(false);
    });
  });

  // --- IDEMPOTENT RE-RUN (alreadyBooked UNIQUE backstop, §6.2) --- //

  it('does not re-book an opening already present at its seq (alreadyBooked backstop, idempotent re-run)', async () => {
    const snapshot = snapshotLog({
      '100': {
        priceChf: 2,
        plusBalance: { total: 5, liquidity: { total: 5, liquidityBalance: { total: 5 } } },
        minusBalance: { total: 0 },
        error: '',
      },
    });
    jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
    jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshot]);
    // the ASSET opening sits at seq 0 → nextSeq already returns 1 → alreadyBooked(seq 0) true → no re-book
    nextSeqByKey.set('cutover:1557344', 1);

    await service.run();

    expect(booked.some((b) => b.legs.some((l) => l.account.type === AccountType.ASSET))).toBe(false);
  });
});
