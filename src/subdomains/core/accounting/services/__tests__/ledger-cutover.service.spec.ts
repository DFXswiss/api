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
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
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
  });
});
