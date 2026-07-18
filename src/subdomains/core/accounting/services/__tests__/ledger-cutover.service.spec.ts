import { createMock } from '@golevelup/ts-jest';
import { CronExpression } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExchangeTx } from 'src/integration/exchange/entities/exchange-tx.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
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
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
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

  // isCoveredByCutoverOpening reads the crypto_input boundary via settingService.getObj. Stub it per test so the per-row
  // received guard keys on the SAME immutable at-snapshot boundary the forward crypto_input seq0 suppression uses (§6.3)
  // — NOT the mutable live status. Other getObj keys (e.g. balanceLogDebtPositions) keep the [] default.
  function stubCryptoInputBoundary(boundary: { boundaryId: number; holeIds: number[] } | undefined): void {
    jest
      .spyOn(settingService, 'getObj')
      .mockImplementation((key: string) =>
        Promise.resolve(key === 'ledgerCutoverBoundary.crypto_input' ? (boundary as any) : ([] as any)),
      );
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
    // m7: openBankTxReturn/Repeat/Unattributed value each bank leg from a single bankByIban() map (bankRepo.find),
    // NOT a per-row bankRepo.findOne — default to no banks (tests that need a match override with a keyed iban)
    jest.spyOn(bankRepo, 'find').mockResolvedValue([]);
    jest.spyOn(settingService, 'getObj').mockResolvedValue([] as any);
    jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map()));

    // watermark MAX(id) query builder stub (chainable where/andWhere for the per-consumer settled filters). getRawMany
    // backs the §6.3 openHoleIds/idsUpToBoundary path; with MAX(id)=0 the boundary is empty so no holes are queried.
    const maxQb: any = {
      select: () => maxQb,
      where: () => maxQb,
      andWhere: () => maxQb,
      getRawOne: () => Promise.resolve({ max: 0 }),
      getRawMany: () => Promise.resolve([]),
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

    // Major B2: openAssets keys each ASSET opening on its OWN sourceId `<logId>:asset:<assetId>` at seq 0 (per-asset
    // marker), NOT a running seq over one `<logId>` sourceId. So a retry after a partial crash re-books EXACTLY the
    // assets whose per-asset opening is missing — with no running-seq drift when a previously-skipped asset gets a CoA
    // account in between. Here asset 100 was already booked on the crashed first run (its per-asset nextSeq is 1) and
    // asset 200 was not; the retry must book ONLY 200, at seq 0, and re-book nothing.
    it('re-books exactly the missing per-asset openings on a retry after a partial crash (no seq drift, B2)', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([
        snapshotLog({
          '100': {
            priceChf: 2,
            plusBalance: { total: 0, liquidity: { total: 0, liquidityBalance: { total: 10 } } },
            minusBalance: { total: 0 },
            error: '',
          },
          '200': {
            priceChf: 3,
            plusBalance: { total: 0, liquidity: { total: 0, liquidityBalance: { total: 5 } } },
            minusBalance: { total: 0 },
            error: '',
          },
        }),
      ]);
      // asset 100's per-asset opening was already booked on the crashed first run → alreadyBooked(seq 0) true → skipped
      nextSeqByKey.set('cutover:1557344:asset:100', 1);

      await service.run();

      // asset 100 NOT re-booked (idempotent per-asset skip); asset 200 booked exactly once, at seq 0, its own sourceId
      expect(booked.some((b) => b.sourceId === '1557344:asset:100')).toBe(false);
      const tx200 = booked.find((b) => b.sourceId === '1557344:asset:200');
      expect(tx200).toBeDefined();
      expect(tx200.seq).toBe(0);
      const assetLeg = tx200.legs.find((l) => l.account.type === AccountType.ASSET);
      expect(assetLeg.amount).toBe(5); // native opening booked exactly once (no drift)
      expect(assetLeg.amountChf).toBe(15); // 5 × priceChf 3
    });
  });

  describe('failure-isolation (§6.3)', () => {
    // run() no longer catches — @DfxCron's lock layer catches + logs (CONTRIBUTING: no redundant try/catch in a
    // @DfxCron method). The failure-isolation semantic holds: the throw propagates before the flag is set, so the flag
    // stays unset and all consumers stay no-op.
    it('propagates a cutover error and never sets the flag (consumers stay no-op)', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      jest.spyOn(logService, 'getFinancialLogs').mockRejectedValue(new Error('boom'));

      await expect(service.run()).rejects.toThrow('boom');

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
            liquidity: {
              total: 0,
              liquidityBalance: { total: 10 },
              paymentDepositBalance: { total: 3 },
              manualLiqPosition: { total: 1 },
            },
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

    // Prod feed shape: paymentDepositBalance / manualLiqPosition are `{ total }`, not bare numbers. Object addition
    // would yield NaN and crash Postgres (`invalid input syntax for type bigint: "NaN"`); .total must be read.
    it('opens ASSET from the real prod { total } shape of paymentDepositBalance and manualLiqPosition', async () => {
      const snapshot = snapshotLog({
        '100': {
          priceChf: 2,
          plusBalance: {
            total: 14.5,
            liquidity: {
              total: 14,
              liquidityBalance: { total: 10 },
              paymentDepositBalance: { total: 2.5 },
              manualLiqPosition: { total: 1.5 },
            },
            custom: { total: 0.5 },
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
      expect(assetLeg.amount).toBe(14.5); // 10 + 2.5 + 1.5 + 0.5
      expect(Number.isFinite(assetLeg.amountChf)).toBe(true);
      expect(assetLeg.amountChf).toBe(29); // 14.5 × priceChf 2
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

    // --- G-a exclusivity (Major): the per-row received opening vs the forward crypto_input seq0 --- //
    // A priced open row whose funding crypto_input was NOT settled at the snapshot (real window: amountInChf is set at
    // AML on isConfirmed, before the input reaches FORWARD_CONFIRMED) must get NO per-row received opening — the forward
    // crypto_input seq0 is the SOLE received opener. Opening it here too would double-credit ${bucket}-received to
    // −2·amountInChf (the cutover / crypto_input sourceId namespaces are disjoint → no UNIQUE backstop), leaving a
    // permanent −amountInChf phantom after the completion debits once. A settled input keeps the per-row opening (its
    // seq0 is suppressed as covered-by-cutover). Card-/bank-funded rows (cryptoInput=null) are unchanged.
    describe('G-a exclusivity: per-row received opening vs the forward crypto_input seq0 (Major)', () => {
      it('skips the buyFiat-received opening for a crypto-funded row whose input was NOT settled at the snapshot', async () => {
        stubCryptoInputBoundary({ boundaryId: 0, holeIds: [] }); // input 800 > boundary 0 → post-boundary → not covered
        jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
        jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
          if (where?.outputAmount)
            return Promise.resolve([
              buyFiat({
                id: 80,
                amountInChf: 15000,
                outputAmount: null,
                cryptoInput: { id: 800, status: PayInStatus.ACKNOWLEDGED } as any, // unsettled at the snapshot
              }),
            ]);
          return Promise.resolve([]);
        });

        await service.run();

        // no per-row opening → the forward crypto_input seq0 opens buyFiat-received exactly once (no double-credit)
        expect(booked.some((b) => b.sourceId === '1557344:buy_fiat:80')).toBe(false);
      });

      it('opens the buyFiat-received per row when the funding crypto_input WAS settled at the snapshot', async () => {
        stubCryptoInputBoundary({ boundaryId: 810, holeIds: [] }); // 810 <= 810, not a hole → covered
        jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
        jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
          if (where?.outputAmount)
            return Promise.resolve([
              buyFiat({
                id: 81,
                amountInChf: 15000,
                outputAmount: null,
                cryptoInput: { id: 810, status: PayInStatus.FORWARD_CONFIRMED } as any, // settled → value in the aggregate
              }),
            ]);
          return Promise.resolve([]);
        });

        await service.run();

        // settled input → its seq0 is suppressed as covered-by-cutover, so the per-row opening is the sole opener
        const receivedTx = booked.find((b) => b.sourceId === '1557344:buy_fiat:81');
        expect(receivedTx).toBeDefined();
        const liabilityLeg = receivedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
        expect(liabilityLeg.account.name).toBe('LIABILITY/buyFiat-received');
        expect(liabilityLeg.amountChf).toBe(-15000);
      });

      it('skips the buyFiat paymentLink opening too when the funding crypto_input was NOT settled at the snapshot', async () => {
        // the guard sits before openBuyFiatRow, so it covers the paymentLink branch as well: the forward crypto_input
        // seq0 (ci.isPayment) opens LIABILITY/paymentLink for an unsettled input, so a per-row paymentLink opening here
        // would double-credit it exactly like the received bucket.
        stubCryptoInputBoundary({ boundaryId: 0, holeIds: [] }); // 820 > 0 → not covered → both paymentLink and received skipped
        jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
        jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
          if (where?.outputAmount)
            return Promise.resolve([
              buyFiat({
                id: 82,
                amountInChf: 1000,
                outputAmount: null,
                cryptoInput: { id: 820, paymentLinkPayment: { id: 1 }, status: PayInStatus.ACKNOWLEDGED } as any, // unsettled
              }),
            ]);
          return Promise.resolve([]);
        });

        await service.run();

        expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-paymentLink:82')).toBe(false);
        expect(booked.some((b) => b.sourceId === '1557344:buy_fiat:82')).toBe(false);
      });

      it('skips the buyCrypto-received opening for a crypto-funded row whose input was NOT settled at the snapshot', async () => {
        stubCryptoInputBoundary({ boundaryId: 0, holeIds: [] }); // input 900 > boundary 0 → post-boundary → not covered
        jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
        jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
          if (where?.outputAmount)
            return Promise.resolve([
              buyCrypto({
                id: 90,
                amountInChf: 1000,
                outputAmount: null,
                cryptoInput: { id: 900, status: PayInStatus.ACKNOWLEDGED } as any, // unsettled at the snapshot
              }),
            ]);
          return Promise.resolve([]);
        });

        await service.run();

        expect(booked.some((b) => b.sourceId === '1557344:buy_crypto:90')).toBe(false);
      });

      it('opens the buyCrypto-received per row when the funding crypto_input WAS settled at the snapshot', async () => {
        stubCryptoInputBoundary({ boundaryId: 910, holeIds: [] }); // 910 <= 910, not a hole → covered
        jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
        jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
          if (where?.outputAmount)
            return Promise.resolve([
              buyCrypto({
                id: 91,
                amountInChf: 1000,
                outputAmount: null,
                cryptoInput: { id: 910, status: PayInStatus.COMPLETED } as any, // settled → value in the aggregate
              }),
            ]);
          return Promise.resolve([]);
        });

        await service.run();

        const receivedTx = booked.find((b) => b.sourceId === '1557344:buy_crypto:91');
        expect(receivedTx).toBeDefined();
        const liabilityLeg = receivedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
        expect(liabilityLeg.account.name).toBe('LIABILITY/buyCrypto-received');
        expect(liabilityLeg.amountChf).toBe(-1000);
      });

      it('opens the buyCrypto-received per row for a Card-funded row (cryptoInput=null, regression)', async () => {
        jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
        jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
          if (where?.outputAmount)
            return Promise.resolve([
              buyCrypto({ id: 92, amountInChf: 1000, outputAmount: null, checkoutTx: { currency: 'EUR' } as any }),
            ]);
          return Promise.resolve([]);
        });

        await service.run();

        // Card row: cryptoInput=null → the guard does not fire → the per-row received opening still books (unchanged)
        expect(booked.some((b) => b.sourceId === '1557344:buy_crypto:92')).toBe(true);
      });

      it('opens the buyCrypto-received per row for a bank-funded row (cryptoInput=null, regression)', async () => {
        jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
        jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
          if (where?.outputAmount)
            return Promise.resolve([
              buyCrypto({ id: 93, amountInChf: 1000, outputAmount: null, bankTx: { id: 500 } as any }),
            ]);
          return Promise.resolve([]);
        });

        await service.run();

        expect(booked.some((b) => b.sourceId === '1557344:buy_crypto:93')).toBe(true);
      });

      it('skips the buyFiat-received opening for a LIVE-settled input the boundary classifies as post-boundary (divergence, no double-credit)', async () => {
        // The per-row opening must be EXACTLY complementary to the forward crypto_input seq0 suppression: both key on the
        // SAME pinned at-snapshot boundary, NEVER on the mutable live status. Here the input settled LIVE
        // (FORWARD_CONFIRMED) AFTER the snapshot — inside a fail-loud retry window — so the boundary still classifies it
        // as post-boundary (boundaryId 0). The forward seq0 opens received (live-settled + not covered); a per-row
        // opening here too would permanently double-credit the bucket. The guard keys on the boundary → the per-row
        // opening is SKIPPED.
        stubCryptoInputBoundary({ boundaryId: 0, holeIds: [] }); // input is post-boundary (settled AFTER the snapshot)
        jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
        jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
          if (where?.outputAmount)
            return Promise.resolve([
              buyFiat({
                id: 83,
                amountInChf: 15000,
                outputAmount: null,
                cryptoInput: { id: 830, status: PayInStatus.FORWARD_CONFIRMED } as any, // LIVE settled in the retry window
              }),
            ]);
          return Promise.resolve([]);
        });

        await service.run();

        // NO per-row cutover opening → the forward crypto_input seq0 is the sole received opener (no double-credit)
        expect(booked.some((b) => b.sourceId === '1557344:buy_fiat:83')).toBe(false);
      });

      it('skips the buyCrypto-received opening for a LIVE-settled input the boundary classifies as post-boundary (divergence, no double-credit)', async () => {
        stubCryptoInputBoundary({ boundaryId: 0, holeIds: [] }); // input is post-boundary (settled AFTER the snapshot)
        jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
        jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
          if (where?.outputAmount)
            return Promise.resolve([
              buyCrypto({
                id: 94,
                amountInChf: 1000,
                outputAmount: null,
                cryptoInput: { id: 940, status: PayInStatus.FORWARD_CONFIRMED } as any, // LIVE settled in the retry window
              }),
            ]);
          return Promise.resolve([]);
        });

        await service.run();

        expect(booked.some((b) => b.sourceId === '1557344:buy_crypto:94')).toBe(false);
      });
    });

    it('opens buyFiat-owed per row CHF = outputAmount × fiat-mark for a foreign-currency (EUR) output (R6-1)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(markService, 'preload')
        .mockResolvedValue(
          new LedgerMarkCache(new Map([[269, [{ created: new Date('2026-06-01'), priceChf: 0.95 }]]])),
        );
      jest.spyOn(bankRepo, 'find').mockResolvedValue([
        Object.assign(new Bank(), {
          id: 10,
          iban: 'EUR-IBAN',
          currency: 'EUR',
          asset: Object.assign(new Asset(), { id: 269 }),
        }),
      ]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        // owed query: isComplete false, no outputAmount filter → return the owed row
        if (!where?.outputAmount) {
          return Promise.resolve([
            buyFiat({
              id: 43,
              outputAmount: 1000,
              outputAsset: Object.assign(new Fiat(), { id: 2, name: 'EUR' }),
            }),
          ]);
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

    it('does not re-open a buyFiat row after mutable routing moves it between received and owed', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      nextSeqByKey.set('cutover:1557344:buy_fiat-owed:56', 1); // prior run opened owed; retry now routes received
      nextSeqByKey.set('cutover:1557344:buy_fiat:57', 1); // prior run opened received; retry now routes owed
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (where?.outputAmount) {
          return Promise.resolve([buyFiat({ id: 56, amountInChf: 1000, outputAmount: null })]);
        }
        return Promise.resolve([
          buyFiat({
            id: 57,
            outputAmount: 1000,
            outputAsset: Object.assign(new Fiat(), { id: 1, name: 'CHF' }),
          }),
        ]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat:56')).toBe(false);
      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-owed:57')).toBe(false);
    });

    // §6.1 (B): paymentLink is a third opening namespace; mutable routing can move a row into/out of it across a
    // fail-loud retry while the snapshot stays pinned. An existing paymentLink opening must block both an owed
    // re-open and a received re-open (and must not re-book paymentLink itself).
    it('does not re-open a buyFiat row after mutable routing moves it into paymentLink from a prior paymentLink opening', async () => {
      stubCryptoInputBoundary({ boundaryId: 900, holeIds: [] }); // covered → paymentLink branch would otherwise book
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      nextSeqByKey.set('cutover:1557344:buy_fiat-paymentLink:58', 1); // prior run opened paymentLink
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        // owed query: outputAmount set + paymentLink → would book buy_fiat-owed or re-book paymentLink without the guard
        if (!where?.outputAmount) {
          return Promise.resolve([
            buyFiat({
              id: 58,
              amountInChf: 1000,
              outputAmount: 940,
              outputAsset: Object.assign(new Fiat(), { id: 1, name: 'CHF' }),
              cryptoInput: { id: 900, paymentLinkPayment: { id: 1 } } as any,
            }),
          ]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-owed:58')).toBe(false);
      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-paymentLink:58')).toBe(false);
    });

    it('does not re-open a buyFiat-received row when a prior paymentLink opening already exists', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      nextSeqByKey.set('cutover:1557344:buy_fiat-paymentLink:59', 1); // prior run opened paymentLink
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        // received query: no outputAmount → would book buy_fiat:59 without the cross-namespace guard
        if (where?.outputAmount) {
          return Promise.resolve([buyFiat({ id: 59, amountInChf: 1000, outputAmount: null })]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat:59')).toBe(false);
      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-paymentLink:59')).toBe(false);
    });

    // §6.1 (B) buy_crypto: same cross-namespace double-open risk as buy_fiat when outputAmount appears/disappears
    // between fail-loud retries while the snapshot stays pinned.
    it('does not re-open a buyCrypto row after mutable routing moves it between received and owed', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      nextSeqByKey.set('cutover:1557344:buy_crypto:70', 1); // prior run opened received; retry now routes owed
      nextSeqByKey.set('cutover:1557344:buy_crypto-owed:71', 1); // prior run opened owed; retry now routes received
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        if (where?.outputAmount) {
          // received query: row 71 has null outputAmount → would re-open buy_crypto without the guard
          return Promise.resolve([buyCrypto({ id: 71, amountInChf: 1000, outputAmount: null })]);
        }
        // owed query: row 70 has outputAmount set → would re-open buy_crypto-owed without the guard
        return Promise.resolve([
          buyCrypto({
            id: 70,
            outputAmount: 1,
            outputAsset: Object.assign(new Asset(), { id: 100 }),
          }),
        ]);
      });
      jest
        .spyOn(markService, 'preload')
        .mockResolvedValue(new LedgerMarkCache(new Map([[100, [{ created: new Date('2026-06-01'), priceChf: 1 }]]])));

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto-owed:70')).toBe(false);
      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto:71')).toBe(false);
    });

    // §4.7b/§6.1 (F1): a paymentLink-funded open buy_fiat (outputAmount NULL) whose financing crypto_input settled
    // PRE-cutover (status ∈ CryptoInputSettledStatus → its value is in the aggregate opening, no forward seq0) is opened
    // on LIABILITY/paymentLink via the per-row marker `${logId}:buy_fiat-paymentLink:${id}` at the gross (amountInChf) —
    // NOT buyFiat-received (which the forward bookPaymentLink path never consumes → permanent content-scan wedge + wrong
    // bucket). The G-a exclusivity guard keeps this opening for a settled input; an UNSETTLED paymentLink input is
    // skipped instead (its forward seq0 opens paymentLink — covered by the dedicated G-a exclusivity tests below).
    it('opens a paymentLink-funded buyFiat-received row on LIABILITY/paymentLink, not buyFiat-received (F1)', async () => {
      stubCryptoInputBoundary({ boundaryId: 815, holeIds: [] }); // covered → paymentLink opening books
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (where?.outputAmount) {
          return Promise.resolve([
            buyFiat({
              id: 45,
              amountInChf: 1000,
              outputAmount: null,
              cryptoInput: { id: 815, paymentLinkPayment: { id: 1 }, status: PayInStatus.FORWARD_CONFIRMED } as any, // settled pre-cutover
            }),
          ]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      const plTx = booked.find((b) => b.sourceId === '1557344:buy_fiat-paymentLink:45');
      expect(plTx).toBeDefined();
      const liabilityLeg = plTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.account.name).toBe('LIABILITY/paymentLink');
      expect(liabilityLeg.amountChf).toBe(-1000); // Cr paymentLink at the gross (amountInChf), CHF-denominated
      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat:45')).toBe(false); // NOT the buyFiat-received bucket
      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-owed:45')).toBe(false);
    });

    // §4.7b/§6.1 (F1): the owed path (outputAmount NOT NULL) also routes a paymentLink row to LIABILITY/paymentLink at
    // the gross (amountInChf), NOT buyFiat-owed (outputAmount × mark). Exercises the openBuyFiatOwed paymentLink branch.
    it('opens a paymentLink-funded owed-straddling buyFiat row on LIABILITY/paymentLink, not buyFiat-owed (F1)', async () => {
      stubCryptoInputBoundary({ boundaryId: 860, holeIds: [] }); // input 860 <= boundary → covered → paymentLink opening books
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        // owed query (no outputAmount key) → a paymentLink row with outputAmount set
        if (!where?.outputAmount) {
          return Promise.resolve([
            buyFiat({
              id: 46,
              amountInChf: 1000,
              outputAmount: 940,
              outputAsset: { id: 1, name: 'CHF' } as any,
              cryptoInput: { id: 860, paymentLinkPayment: { id: 1 } } as any,
            }),
          ]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      const plTx = booked.find((b) => b.sourceId === '1557344:buy_fiat-paymentLink:46');
      expect(plTx).toBeDefined();
      const liabilityLeg = plTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.account.name).toBe('LIABILITY/paymentLink');
      expect(liabilityLeg.amountChf).toBe(-1000); // gross (amountInChf), NOT outputAmount × mark (940)
      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-owed:46')).toBe(false); // NOT the owed bucket
    });

    // §6.1 (F1) G-a divergence — the openBuyFiatOwed guard. The buyFiat-owed and paymentLink per-row openings must be
    // EXACTLY complementary to the forward crypto_input seq0 suppression: both key on the pinned at-snapshot boundary
    // (isCoveredByCutoverOpening), NEVER on the mutable live status. Two owed-straddling rows with the SAME live-settled
    // status but split by the boundary: the covered one opens (its seq0 is suppressed → the per-row opening is the sole
    // opener), the post-boundary one is skipped (its forward seq0 is the sole opener → a per-row opening would
    // double-credit the bucket, a permanent phantom with no UNIQUE backstop).
    it('opens the buyFiat-owed per row for a covered input but skips a post-boundary one (G-a divergence, F1)', async () => {
      stubCryptoInputBoundary({ boundaryId: 870, holeIds: [] }); // 870 covered; 880 > boundary → not covered
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount)
          return Promise.resolve([
            buyFiat({
              id: 47,
              outputAmount: 1000,
              outputAsset: { id: 1, name: 'CHF' } as any,
              cryptoInput: { id: 870, status: PayInStatus.FORWARD_CONFIRMED } as any, // covered by the boundary
            }),
            buyFiat({
              id: 48,
              outputAmount: 1000,
              outputAsset: { id: 1, name: 'CHF' } as any,
              cryptoInput: { id: 880, status: PayInStatus.FORWARD_CONFIRMED } as any, // post-boundary → not covered
            }),
          ]);
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-owed:47')).toBe(true); // covered → opens as before
      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-owed:48')).toBe(false); // not covered → forward seq0 is sole opener
    });

    // §6.1 (F1) G-a divergence — the paymentLink branch of openBuyFiatOwed obeys the SAME boundary guard: a covered
    // input opens LIABILITY/paymentLink at the gross (amountInChf); a post-boundary input is skipped (its forward seq0
    // opens paymentLink → a per-row opening would double-credit it).
    it('opens the buyFiat paymentLink per row for a covered input but skips a post-boundary one (G-a divergence, F1)', async () => {
      stubCryptoInputBoundary({ boundaryId: 890, holeIds: [] }); // 890 covered; 895 > boundary → not covered
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount)
          return Promise.resolve([
            buyFiat({
              id: 51,
              amountInChf: 1000,
              outputAmount: 940,
              outputAsset: { id: 1, name: 'CHF' } as any,
              cryptoInput: { id: 890, paymentLinkPayment: { id: 1 }, status: PayInStatus.FORWARD_CONFIRMED } as any, // covered
            }),
            buyFiat({
              id: 52,
              amountInChf: 1000,
              outputAmount: 940,
              outputAsset: { id: 1, name: 'CHF' } as any,
              cryptoInput: { id: 895, paymentLinkPayment: { id: 1 }, status: PayInStatus.FORWARD_CONFIRMED } as any, // not covered
            }),
          ]);
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-paymentLink:51')).toBe(true); // covered → opens
      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-paymentLink:52')).toBe(false); // not covered → skipped
    });

    // §6.1 (F1) G-a divergence — the openBuyCryptoOwed guard. The per-row buyCrypto-owed opening must be EXACTLY
    // complementary to the forward crypto_input seq0/seq1 handling: it keys on the pinned at-snapshot boundary
    // (isCoveredByCutoverOpening), NEVER on the mutable live status. A COVERED input (its value is in the aggregate
    // opening, its forward seq0 suppressed) keeps the per-row owed opening — the sole owed opener.
    it('opens the buyCrypto-owed per row when the funding crypto_input IS covered by the boundary (G-a divergence, F1)', async () => {
      stubCryptoInputBoundary({ boundaryId: 950, holeIds: [] }); // input 950 <= boundary → covered
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(markService, 'preload')
        .mockResolvedValue(
          new LedgerMarkCache(new Map([[42, [{ created: new Date('2026-06-01'), priceChf: 30000 }]]])),
        );
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount)
          return Promise.resolve([
            buyCrypto({
              id: 62,
              outputAmount: 0.5,
              outputAsset: { id: 42 } as any,
              cryptoInput: { id: 950, status: PayInStatus.FORWARD_CONFIRMED } as any, // covered by the boundary
            }),
          ]);
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto-owed:62')).toBe(true); // covered → opens as before
    });

    // §6.1 (F1) G-a divergence — the mirror case: an input NOT covered by the pinned boundary (a post-boundary settle, or
    // an `updated` bump FORWARD_CONFIRMED→COMPLETED inside the [snapshot→pin] retry window) is SKIPPED here. Its forward
    // crypto_input seq0 opens buyCrypto-received and the completion seq1 closes it; a per-row owed opening would make that
    // seq1 SKIP via hasCutoverOwedOpening → the received leg would never close (orphaned received phantom, no UNIQUE
    // backstop). The forward seq0/seq1 chain is the sole handler.
    it('skips the buyCrypto-owed opening for a crypto-funded row whose input is NOT covered (G-a divergence, F1)', async () => {
      stubCryptoInputBoundary({ boundaryId: 950, holeIds: [] }); // input 960 > boundary → not covered
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(markService, 'preload')
        .mockResolvedValue(
          new LedgerMarkCache(new Map([[42, [{ created: new Date('2026-06-01'), priceChf: 30000 }]]])),
        );
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount)
          return Promise.resolve([
            buyCrypto({
              id: 63,
              outputAmount: 0.5,
              outputAsset: { id: 42 } as any,
              cryptoInput: { id: 960, status: PayInStatus.FORWARD_CONFIRMED } as any, // post-boundary → not covered
            }),
          ]);
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto-owed:63')).toBe(false); // not covered → forward seq0/seq1 is sole handler
    });

    // m6 fail-loud: a feedless buyCrypto-owed opening (no mark for the outputAsset) would book a CHF liability with
    // native 0 that the mark-to-market job can NEVER revalue → the cutover THROWS and leaves the ledger-ready flag
    // unset (retry once the mark feed is back), rather than silently dropping the value into a stale zero-opening.
    it('throws (m6) on a feedless buyCrypto-owed opening and leaves the ledger-ready flag unset', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) {
          return Promise.resolve([buyCrypto({ id: 50, outputAmount: 2, outputAsset: { id: 999 } as any })]); // no mark
        }
        return Promise.resolve([]);
      });

      await expect(service.run()).rejects.toThrow(/without a mark/i);

      const flagSet = (settingService.set as jest.Mock).mock.calls.find((c) => c[0] === 'ledgerCutoverLogId');
      expect(flagSet).toBeUndefined(); // ledger-ready flag NOT set → all consumers stay no-op, retry next cron run
      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto-owed:50')).toBe(false); // no zero-opening booked
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
        .spyOn(bankRepo, 'find')
        .mockResolvedValue([
          Object.assign(new Bank(), { iban: 'EUR-IBAN', name: 'Olkypay', currency: 'EUR', asset: { id: 269 } }),
        ] as any);
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
        .spyOn(bankRepo, 'find')
        .mockResolvedValue([
          Object.assign(new Bank(), { iban: 'CHF-IBAN', name: 'Yapeal', currency: 'CHF', asset: { id: 100 } }),
        ] as any);
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
        .spyOn(bankRepo, 'find')
        .mockResolvedValue([
          Object.assign(new Bank(), { iban: 'EUR-IBAN', name: 'Olkypay', currency: 'EUR', asset: { id: 269 } }),
        ] as any);
      // ONE find() serves both ORed where-branches (typed GSheet/Pending/Unknown credits + NULL-type credits)
      jest
        .spyOn(bankTxRepo, 'find')
        .mockResolvedValue([
          Object.assign(new BankTx(), { id: 90, amount: 1000, accountIban: 'EUR-IBAN', currency: 'EUR' }),
          Object.assign(new BankTx(), { id: 91, amount: 2000, accountIban: 'EUR-IBAN', currency: 'EUR' }),
        ] as any);

      await service.run();

      const unattributedTx = booked.find((b) => b.sourceId === '1557344:unattributed');
      expect(unattributedTx).toBeDefined();
      const liabilityLeg = unattributedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.account.name).toBe('LIABILITY/unattributed');
      expect(liabilityLeg.amountChf).toBe(-2850); // (1000 + 2000) × 0.95, aggregated, CHF-denominated
    });

    it('values an unattributed EUR credit on an untracked bank through the representative currency asset', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(markService, 'preload')
        .mockResolvedValue(
          new LedgerMarkCache(new Map([[269, [{ created: new Date('2026-06-01'), priceChf: 0.95 }]]])),
        );
      jest.spyOn(bankRepo, 'find').mockResolvedValue([
        Object.assign(new Bank(), { id: 10, iban: 'UNTRACKED-EUR', currency: 'EUR', asset: undefined }),
        Object.assign(new Bank(), {
          id: 20,
          iban: 'TRACKED-EUR',
          currency: 'EUR',
          asset: Object.assign(new Asset(), { id: 269 }),
        }),
      ]);
      jest
        .spyOn(bankTxRepo, 'find')
        .mockResolvedValueOnce([
          Object.assign(new BankTx(), { id: 92, amount: 1000, accountIban: 'UNTRACKED-EUR', currency: 'EUR' }),
        ])
        .mockResolvedValueOnce([]);

      await service.run();

      const unattributedTx = booked.find((b) => b.sourceId === '1557344:unattributed');
      expect(unattributedTx).toBeDefined();
      const liabilityLeg = unattributedTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.amountChf).toBe(-950);
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

    // §6.3: the pinned snapshot date is exported (= snapshot.created) so a forward consumer can classify a
    // pre-cutover-settled row; it MUST be set before the ready flag (a consumer that sees the flag can already classify).
    it('exports the snapshot date (ledgerCutoverSnapshotDate) = snapshot.created before the ready flag', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await service.run();

      const keys = setSpy.mock.calls.map((c) => c[0]);
      const dateCall = setSpy.mock.calls.find((c) => c[0] === 'ledgerCutoverSnapshotDate');
      expect(dateCall).toBeDefined();
      expect(dateCall[1]).toBe('2026-06-07T22:00:00.000Z'); // = snapshot.created
      expect(keys.indexOf('ledgerCutoverSnapshotDate')).toBeLessThan(keys.indexOf('ledgerCutoverLogId'));
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
          // §6.3 openHoleIds id query — the boundary content is asserted separately; here it only needs to resolve
          getRawMany: () => Promise.resolve([]),
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

    // §6.3: the guard sources persist an immutable cutover boundary (ledgerCutoverBoundary.<source>) = boundaryId
    // (MAX settled id) + holeIds (ids <= boundary that were OPEN at the snapshot = allRecent MINUS settledRecent). A
    // settled-at-snapshot row must NEVER appear as a hole (that would re-book it post-cutover → double-count). Here:
    // MAX(settled)=100, recent ids <= 100 = [40,50,60], settled-recent = [40,60] → holeIds = [50]. Non-guard sources
    // (bank_tx) persist NO boundary.
    it('persists the cutover boundary (boundaryId + open-hole ids) for a guard source but not for a non-guard source', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      // a fresh qb per createQueryBuilder call so the status-filter flag never leaks across the MAX(id) and the two
      // openHoleIds id queries: no status filter → all recent ids; status filter applied → only the settled recent ids.
      jest.spyOn(cryptoInputRepo, 'createQueryBuilder').mockImplementation(() => {
        let hasStatusFilter = false;
        const qb: any = {
          select: () => qb,
          where: () => qb,
          andWhere: (clause: string) => {
            if (/e\.status/i.test(clause)) hasStatusFilter = true;
            return qb;
          },
          getRawOne: () => Promise.resolve({ max: 100 }),
          getRawMany: () => Promise.resolve((hasStatusFilter ? [40, 60] : [40, 50, 60]).map((id) => ({ id }))),
        };
        return qb;
      });

      await service.run();

      const ciBoundary = setSpy.mock.calls.find((c) => c[0] === 'ledgerCutoverBoundary.crypto_input');
      expect(ciBoundary).toBeDefined();
      expect(JSON.parse(ciBoundary[1])).toEqual({ boundaryId: 100, holeIds: [50] }); // 50 was open → the only hole
      // bank_tx is watermark-only (not a guard source) → no boundary persisted
      expect(setSpy.mock.calls.some((c) => c[0] === 'ledgerCutoverBoundary.bank_tx')).toBe(false);
    });

    // §6.3 (F1): boundary+watermark are pinned set-only-if-unset BEFORE any opening, so a fail-loud opening retry
    // reuses the run-1 boundary VERBATIM instead of recomputing it against a drifted DB. Here row 50 is settled at
    // the snapshot in run 1 (→ holeIds []), but its `updated` is bumped between the runs, so the run-2 settled
    // predicate no longer matches it (a recompute would yield holeIds [50]). Freezing the boundary prevents the
    // forward consumer from reclassifying row 50 as a hole and double-booking its seq0 onto the aggregate opening
    // (the F1 double-count).
    it('reuses the pinned boundary+watermark verbatim on a fail-loud retry (set-only-if-unset, no recompute)', async () => {
      // STATEFUL setting store: run 1 pins snapshot+boundary+watermarks, then crashes in the openings; run 2 (the
      // cron retry hours later) must reuse every pinned value instead of recomputing it.
      const settings = new Map<string, string>();
      jest.spyOn(settingService, 'get').mockImplementation((key: string) => Promise.resolve(settings.get(key) as any));
      jest.spyOn(settingService, 'set').mockImplementation((key: string, value: string) => {
        settings.set(key, value);
        return Promise.resolve();
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(logService, 'getLog')
        .mockImplementation((id: number) => Promise.resolve(id === 1557344 ? snapshotLog({}) : (undefined as any)));

      let run = 1;
      // crypto_input qb: MAX(id) 100 in BOTH runs; the openHoleIds id-queries differ — run 1 sees row 50 SETTLED
      // (with-status-filter [50,60] → holeIds []), in run 2 row 50 fell OUT of the settled predicate (`updated`
      // bumped between the runs → with-status-filter only [60] → a recompute would record holeIds [50]).
      jest.spyOn(cryptoInputRepo, 'createQueryBuilder').mockImplementation(() => {
        let hasStatusFilter = false;
        const qb: any = {
          select: () => qb,
          where: () => qb,
          andWhere: (clause: string) => {
            if (/e\.status/i.test(clause)) hasStatusFilter = true;
            return qb;
          },
          getRawOne: () => Promise.resolve({ max: 100 }),
          getRawMany: () =>
            Promise.resolve((hasStatusFilter ? (run === 1 ? [50, 60] : [60]) : [50, 60]).map((id) => ({ id }))),
        };
        return qb;
      });

      // run 1 throws AFTER the pin step: an owed buy_crypto row whose outputAsset has no mark (empty LedgerMarkCache
      // from the default beforeEach) → bookReceivedOwedOpening throws → openings abort, ready flag stays unset. The
      // owed query is the only buyCryptoRepo.find with an outputAsset relation (openBuyCryptoOwed).
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where, relations }: any) => {
        if (run === 1 && where?.isComplete === false && relations?.outputAsset) {
          return Promise.resolve([buyCrypto({ id: 60, outputAmount: 2, outputAsset: { id: 999 } as any })]);
        }
        return Promise.resolve([]); // run 2: the row resolved in the meantime → no open rows left
      });

      await expect(service.run()).rejects.toThrow(/without a mark/i);
      expect(settings.get('ledgerCutoverLogId')).toBeUndefined(); // fail-loud → flag unset → the cron retries

      run = 2;
      await service.run(); // retry against the drifted DB → completes WITHOUT recomputing boundary/watermark

      // run-1 boundary reused verbatim — NOT overwritten to holeIds [50] from the drifted run-2 predicate
      expect(JSON.parse(settings.get('ledgerCutoverBoundary.crypto_input'))).toEqual({ boundaryId: 100, holeIds: [] });
      const setCalls = (settingService.set as jest.Mock).mock.calls;
      expect(setCalls.filter((c) => c[0] === 'ledgerCutoverBoundary.crypto_input')).toHaveLength(1); // pinned ONCE
      const wmCalls = setCalls.filter((c) => c[0] === 'ledgerWatermark.crypto_input');
      expect(wmCalls).toHaveLength(1); // the watermark is pinned exactly once too (run 2 reuses it)
      expect(JSON.parse(wmCalls[0][1]).lastProcessedId).toBe(100); // == boundaryId (derived from the pinned boundary)
      expect(settings.get('ledgerCutoverLogId')).toBe('1557344'); // run 2 completed on the pinned snapshot
    });

    // §6.3 (F1): mid-loop resume — a crash BETWEEN the boundary write and the watermark write (boundary pinned,
    // watermark unset) must re-derive the watermark from the PINNED boundaryId on the retry, never from a fresh
    // MAX(id) recompute (the drifted DB would yield a different id → lastProcessedId ≠ boundaryId → the guard's
    // covered/hole classification and the forward scan would disagree about the same rows).
    it('derives the watermark from an already-pinned boundary without recomputing it (mid-loop resume)', async () => {
      const settings = new Map<string, string>();
      // pre-seeded state: the previous run pinned the crypto_input boundary, then crashed before its watermark write
      settings.set('ledgerCutoverBoundary.crypto_input', JSON.stringify({ boundaryId: 100, holeIds: [] }));
      jest.spyOn(settingService, 'get').mockImplementation((key: string) => Promise.resolve(settings.get(key) as any));
      jest.spyOn(settingService, 'set').mockImplementation((key: string, value: string) => {
        settings.set(key, value);
        return Promise.resolve();
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(logService, 'getLog')
        .mockImplementation((id: number) => Promise.resolve(id === 1557344 ? snapshotLog({}) : (undefined as any)));

      // drifted DB on the retry: a fresh MAX(id) would now yield 777 — the pinned boundary (100) must win
      jest.spyOn(cryptoInputRepo, 'createQueryBuilder').mockImplementation(() => {
        const qb: any = {
          select: () => qb,
          where: () => qb,
          andWhere: () => qb,
          getRawOne: () => Promise.resolve({ max: 777 }),
          getRawMany: () => Promise.resolve([{ id: 777 }]),
        };
        return qb;
      });

      await service.run();

      // the boundary was NOT recomputed/overwritten (no write at all — it was already pinned)
      const setCalls = (settingService.set as jest.Mock).mock.calls;
      expect(setCalls.filter((c) => c[0] === 'ledgerCutoverBoundary.crypto_input')).toHaveLength(0);
      expect(JSON.parse(settings.get('ledgerCutoverBoundary.crypto_input'))).toEqual({ boundaryId: 100, holeIds: [] });
      // the watermark derives from the PINNED boundaryId (100), not from the drifted MAX(id) 777
      expect(JSON.parse(settings.get('ledgerWatermark.crypto_input')).lastProcessedId).toBe(100);
      expect(settings.get('ledgerCutoverLogId')).toBe('1557344'); // the resume completes the cutover
    });
  });

  // --- SNAPSHOT SELECTION + PINNING (§6.3 / Major design-accounting R3-1) --- //

  describe('snapshot selection + pinning (R3-1)', () => {
    it('throws when there is no valid FinancialDataLog snapshot ≤ cutoff date (flag stays unset)', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      // selectSnapshot reads getFinancialLogs and keeps only rows created ≤ now; a single FUTURE-dated row is filtered
      // out → no snapshot → cutover throws → the throw propagates to @DfxCron → flag stays unset.
      const future = Object.assign(new Log(), { id: 1, created: new Date(Date.now() + 86400000), valid: true });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([future]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await expect(service.run()).rejects.toThrow('No valid FinancialDataLog snapshot available for cutover');

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

    it('throws when the pinned snapshot log no longer exists (flag stays unset)', async () => {
      jest.spyOn(settingService, 'get').mockImplementation((key: string) => {
        if (key === 'ledgerCutoverSnapshotLogId') return Promise.resolve('999');
        return Promise.resolve(undefined);
      });
      jest.spyOn(logService, 'getLog').mockResolvedValue(null); // pinned log was deleted
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await expect(service.run()).rejects.toThrow('Pinned cutover snapshot FinancialDataLog #999 no longer exists');

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

    it('throws when the snapshot message is not parseable JSON (flag stays unset)', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      const broken = Object.assign(new Log(), {
        id: 1557344,
        created: new Date('2026-06-07T22:00:00Z'),
        valid: true,
        message: '{ not valid json',
      });
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([broken]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();

      await expect(service.run()).rejects.toThrow('message is not parseable');

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

    // F2: a buyFiat-received row with a NULL amountInChf has no CHF anchor → no per-row opening. Its id is PINNED as
    // unpriced-at-cutover so the forward consumer skips+advances (alarm) instead of wedging on the never-opened gate.
    it('pins a buyFiat-received row with a null amountInChf as unpriced-at-cutover (no per-row opening; F2)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (where?.outputAmount) return Promise.resolve([buyFiat({ id: 42, amountInChf: null, outputAmount: null })]);
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat:42')).toBe(false); // no CHF anchor → no per-row opening
      const pin = setSpy.mock.calls.find((c) => c[0] === 'ledgerCutoverUnpricedIds.buy_fiat');
      expect(pin).toBeDefined();
      expect(JSON.parse(pin[1])).toEqual([42]); // F2: pinned → forward consumer skips+advances (alarm), never wedges
    });

    // §6.1 (B) + F2: a row already opened under another namespace must not be re-pinned as unpriced when the retry
    // re-routes it into the received query with a null amountInChf (would make the forward consumer treat a real
    // opening as missing → phantom unpriced state).
    it('does not pin an already-opened buyFiat row as unpriced when amountInChf is null on retry', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      nextSeqByKey.set('cutover:1557344:buy_fiat-owed:72', 1); // prior run opened owed
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        // received query: null amountInChf would pin as unpriced without the early cross-namespace guard
        if (where?.outputAmount) {
          return Promise.resolve([buyFiat({ id: 72, amountInChf: null, outputAmount: null })]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat:72')).toBe(false);
      const pin = setSpy.mock.calls.find((c) => c[0] === 'ledgerCutoverUnpricedIds.buy_fiat');
      expect(pin).toBeUndefined(); // already opened → must not re-pin as unpriced
    });

    // F2: bank/crypto-funded AND Card open received rows with a NULL amountInChf are pinned as unpriced-at-cutover; a
    // priced row is still opened normally. The pin lets the forward buildCardInputSeq0 suppress the Card seq0 (its gross
    // is in the aggregate opening) and the completion scan skip+advance without a wedge.
    it('opens priced buyCrypto-received rows and pins null-amountInChf rows (bank + Card) as unpriced (F2)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        // received query: outputAmount IS NULL → one priced row (60) + one unpriced bank/crypto (61) + one unpriced Card (62)
        if (where?.outputAmount) {
          return Promise.resolve([
            buyCrypto({ id: 60, amountInChf: 15000, outputAmount: null }),
            buyCrypto({ id: 61, amountInChf: null, outputAmount: null }),
            buyCrypto({ id: 62, amountInChf: null, outputAmount: null, checkoutTx: { currency: 'EUR' } as any }),
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
      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto:61')).toBe(false); // unpriced → no opening
      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto:62')).toBe(false); // unpriced Card → no opening
      const pin = setSpy.mock.calls.find((c) => c[0] === 'ledgerCutoverUnpricedIds.buy_crypto');
      expect(pin).toBeDefined();
      expect(JSON.parse(pin[1])).toEqual([61, 62]); // both unpriced ids pinned (bank/crypto + Card)
    });

    // MAJOR (B1): Card inputs (checkoutTx != null) are INCLUDED in the per-row buyCrypto-received opening, symmetrically
    // to bank/crypto-funded open rows — an open Card row's gross is already in the aggregate ASSET opening (the
    // Checkout.com collateral feed) and this per-row opening covers the received LIABILITY side. The forward Card seq0
    // is gated to SKIP when this marker exists (buy-crypto.consumer.buildCardInputSeq0). Asserts the received query does
    // NOT filter on checkoutTx (both the non-Card and the Card row are opened).
    it('includes Card inputs (checkoutTx) in the per-row buyCrypto-received opening (B1)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      let receivedWhere: any;
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        // received query: outputAmount IS NULL. The service must NOT filter on checkoutTx → capture the where to assert
        // the Card row is returned (not filtered out) and opened per-row.
        if (where?.outputAmount) {
          receivedWhere = where;
          return Promise.resolve([
            buyCrypto({ id: 60, amountInChf: 15000, outputAmount: null }), // non-Card → opened
            buyCrypto({ id: 61, amountInChf: 15000, outputAmount: null, checkoutTx: { currency: 'EUR' } as any }), // Card
          ]);
        }
        return Promise.resolve([]);
      });

      await service.run();

      expect(receivedWhere?.checkoutTx).toBeUndefined(); // no checkoutTx filter → Card rows are NOT excluded (B1)
      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto:60')).toBe(true); // non-Card opened
      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto:61')).toBe(true); // Card ALSO opened (B1)
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

    // m6 fail-loud: an unattributed aggregate with a credit that cannot be valued (no mark) would book a CHF liability
    // with native 0, never revalued → the cutover THROWS and leaves the flag unset (retry when the feed is back).
    it('throws (m6) on an unvaluable unattributed credit and leaves the ledger-ready flag unset', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      // no mark in the cache + the bank match resolves to an EUR bank whose asset has no mark → mark == null → unvaluable
      jest
        .spyOn(bankRepo, 'find')
        .mockResolvedValue([
          Object.assign(new Bank(), { iban: 'EUR-IBAN', name: 'Olkypay', currency: 'EUR', asset: { id: 269 } }),
        ] as any);
      jest
        .spyOn(bankTxRepo, 'find')
        .mockResolvedValueOnce([
          Object.assign(new BankTx(), { id: 90, amount: 1000, accountIban: 'EUR-IBAN', currency: 'EUR' }),
        ] as any)
        .mockResolvedValueOnce([]);

      await expect(service.run()).rejects.toThrow(/without a mark/i);

      const flagSet = (settingService.set as jest.Mock).mock.calls.find((c) => c[0] === 'ledgerCutoverLogId');
      expect(flagSet).toBeUndefined();
      expect(booked.some((b) => b.sourceId === '1557344:unattributed')).toBe(false);
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
      jest.spyOn(bankRepo, 'find').mockResolvedValue([]); // no Bank row, but the tx itself is CHF → mark 1
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

    it('throws (m6) on a priced buyFiat-owed row without an output currency', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest
        .spyOn(markService, 'preload')
        .mockResolvedValue(
          new LedgerMarkCache(new Map([[269, [{ created: new Date('2026-06-01'), priceChf: 0.95 }]]])),
        );
      jest.spyOn(bankRepo, 'find').mockResolvedValue([
        Object.assign(new Bank(), {
          id: 10,
          iban: 'EUR-IBAN',
          currency: 'EUR',
          asset: Object.assign(new Asset(), { id: 269 }),
        }),
      ]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) {
          return Promise.resolve([buyFiat({ id: 58, outputAmount: 1000, outputAsset: undefined })]);
        }
        return Promise.resolve([]);
      });

      await expect(service.run()).rejects.toThrow(/without a mark/i);

      const flagSet = (settingService.set as jest.Mock).mock.calls.find((c) => c[0] === 'ledgerCutoverLogId');
      expect(flagSet).toBeUndefined();
      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-owed:58')).toBe(false);
    });

    // m6 fail-loud (F2): a foreign-currency (EUR) buyFiat-owed opening without a fiat-mark would silently skip an
    // opening the forward path can NEVER supply — buy-fiat bookRegular skips seq1 for an owed-straddling row and
    // anchors seq2/seq3 on this opening, so the row would gate-block the content-change scan forever. The cutover
    // THROWS and leaves the ledger-ready flag unset (retry once the mark feed is back).
    it('throws (m6) on a foreign-currency buyFiat-owed opening when its fiat-mark is missing', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map())); // no mark for asset 7
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) {
          return Promise.resolve([buyFiat({ id: 51, outputAmount: 1000, outputAsset: { id: 7, name: 'EUR' } as any })]);
        }
        return Promise.resolve([]);
      });

      await expect(service.run()).rejects.toThrow(/without a mark/i);

      const flagSet = (settingService.set as jest.Mock).mock.calls.find((c) => c[0] === 'ledgerCutoverLogId');
      expect(flagSet).toBeUndefined(); // ledger-ready flag NOT set → all consumers stay no-op, retry next cron run
      expect(booked.some((b) => b.sourceId === '1557344:buy_fiat-owed:51')).toBe(false); // no zero-opening booked
    });

    // currencyMark miss: a foreign-currency buyFiat-owed whose currency has NO tracked bank asset to supply the mark
    // → undefined → amountChf undefined → the same m6 fail-loud as the missing-mark case. The Fiat's own id is
    // irrelevant here (it never keys the asset mark cache) — only the currency name resolves a mark.
    it('throws (m6) on a foreign-currency buyFiat-owed opening when no tracked bank supplies that currency mark', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyFiatRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) {
          // outputAsset.name 'EUR' (not CHF), but no EUR bank asset is tracked → currencyMark undefined → throw
          return Promise.resolve([buyFiat({ id: 53, outputAmount: 1000, outputAsset: { name: 'EUR' } as any })]);
        }
        return Promise.resolve([]);
      });

      await expect(service.run()).rejects.toThrow(/without a mark/i);

      const flagSet = (settingService.set as jest.Mock).mock.calls.find((c) => c[0] === 'ledgerCutoverLogId');
      expect(flagSet).toBeUndefined();
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

    // §6.1 openBuyCryptoOwed line 349 (`outputAsset?.id != null` FALSE side): an owed row whose outputAsset has NO id →
    // mark undefined → amountChf undefined → m6 fail-loud (the CHF owed opening would never be revalued). Distinct from
    // the id-present-no-mark case, but the same fail-loud outcome.
    it('throws (m6) on a buyCrypto-owed opening whose outputAsset has no id (line 349 null-id side)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(({ where }: any) => {
        if (!where?.outputAmount) {
          return Promise.resolve([buyCrypto({ id: 55, outputAmount: 2, outputAsset: {} as any })]); // no id → no mark
        }
        return Promise.resolve([]);
      });

      await expect(service.run()).rejects.toThrow(/without a mark/i);

      const flagSet = (settingService.set as jest.Mock).mock.calls.find((c) => c[0] === 'ledgerCutoverLogId');
      expect(flagSet).toBeUndefined();
      expect(booked.some((b) => b.sourceId === '1557344:buy_crypto-owed:55')).toBe(false);
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

    // §6.1 openOpenLiabilityRow (bankTx-return/repeat): a row with a valid amount but NO mark → amountChf undefined →
    // m6 fail-loud (a CHF return opening booked with native 0 is never revalued). EUR bank, empty mark cache.
    it('throws (m6) on a bankTx-return opening when the bank mark is missing', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map())); // no EUR mark
      jest
        .spyOn(bankRepo, 'find')
        .mockResolvedValue([
          Object.assign(new Bank(), { iban: 'EUR-IBAN', name: 'Olkypay', currency: 'EUR', asset: { id: 269 } }),
        ] as any);
      jest.spyOn(bankTxReturnRepo, 'find').mockResolvedValue([
        Object.assign(new BankTxReturn(), {
          bankTx: Object.assign(new BankTx(), { id: 95, amount: 400, accountIban: 'EUR-IBAN', currency: 'EUR' }),
        }),
      ] as any);

      await expect(service.run()).rejects.toThrow(/without a mark/i);

      const flagSet = (settingService.set as jest.Mock).mock.calls.find((c) => c[0] === 'ledgerCutoverLogId');
      expect(flagSet).toBeUndefined();
      expect(booked.some((b) => b.sourceId === '1557344:bank_tx-return:95')).toBe(false);
    });

    // §4.2/§1.6 bankMark: a bank_tx with NO accountIban (line 489 null side) and currency EUR → no bank lookup, no
    // asset → mark undefined → amountChf undefined → m6 fail-loud (the CHF unattributed bucket is never revalued).
    it('throws (m6) on an unattributed credit whose bank_tx has no accountIban and a non-CHF currency', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map()));
      jest
        .spyOn(bankTxRepo, 'find')
        .mockResolvedValueOnce([
          Object.assign(new BankTx(), { id: 96, amount: 700, accountIban: null, currency: 'EUR' }), // no iban → no bank
        ] as any)
        .mockResolvedValueOnce([]);

      await expect(service.run()).rejects.toThrow(/without a mark/i);

      const flagSet = (settingService.set as jest.Mock).mock.calls.find((c) => c[0] === 'ledgerCutoverLogId');
      expect(flagSet).toBeUndefined();
      expect(booked.some((b) => b.sourceId === '1557344:unattributed')).toBe(false);
    });

    // §4.2/§1.6 bankMark: a bank match whose asset is undefined (line 495 `asset?.id != null` false side) and a
    // non-CHF currency → mark undefined → amountChf undefined → m6 fail-loud.
    it('throws (m6) on an unattributed credit whose matched bank has no asset', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]);
      jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(new Map()));
      jest
        .spyOn(bankRepo, 'find')
        .mockResolvedValue([
          Object.assign(new Bank(), { iban: 'EUR-IBAN', name: 'Olkypay', currency: 'EUR', asset: undefined }),
        ] as any);
      jest
        .spyOn(bankTxRepo, 'find')
        .mockResolvedValueOnce([
          Object.assign(new BankTx(), { id: 97, amount: 800, accountIban: 'EUR-IBAN', currency: 'EUR' }),
        ] as any)
        .mockResolvedValueOnce([]);

      await expect(service.run()).rejects.toThrow(/without a mark/i);

      const flagSet = (settingService.set as jest.Mock).mock.calls.find((c) => c[0] === 'ledgerCutoverLogId');
      expect(flagSet).toBeUndefined();
      expect(booked.some((b) => b.sourceId === '1557344:unattributed')).toBe(false);
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
      expect(manualTx.seq).toBe(0); // per-row opening (unique sourceId per assetId), like the received/owed markers
      const liabilityLeg = manualTx.legs.find((l) => l.account.type === AccountType.LIABILITY);
      expect(liabilityLeg.account.name).toBe('LIABILITY/manual-debt');
      expect(liabilityLeg.amountChf).toBe(-2000); // −(priceChf 2 × value 1000), the debt side only (Minor R6-5)
      expect(liabilityLeg.amount).toBe(-2000); // CHF-denominated liability → native amount = CHF (priceChf 1)
      expect(liabilityLeg.priceChf).toBe(1);
      const equityLeg = manualTx.legs.find((l) => l.account.type === AccountType.EQUITY);
      expect(equityLeg.amountChf).toBe(2000); // Dr EQUITY/opening-balance counter
    });

    it('skips a manual-debt position with no value (no leg)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({ '100': { priceChf: 2 } })]);
      jest.spyOn(settingService, 'getObj').mockResolvedValue([
        { assetId: 100, value: 0 }, // no value → skipped, books nothing
        { assetId: 100, value: 500 }, // bookable
      ] as any);

      await service.run();

      const manualTxs = booked.filter((b) => b.sourceId === '1557344:manual-debt:100');
      expect(manualTxs).toHaveLength(1); // only the valued position books
      expect(manualTxs[0].seq).toBe(0);
      expect(manualTxs[0].legs.find((l) => l.account.type === AccountType.LIABILITY).amountChf).toBe(-1000);
    });

    // m6 fail-loud (F1): a manual-debt position whose asset has no priceChf in the snapshot would book a CHF liability
    // (no assetId) the mark-to-market job can NEVER revalue → the cutover THROWS and leaves the ledger-ready flag
    // unset (retry once the price feed is back), rather than silently dropping the CHF value or booking native units.
    it('throws (m6) on a manual-debt position whose asset has no priceChf in the snapshot', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([snapshotLog({})]); // asset 100 not in the snapshot
      jest.spyOn(settingService, 'getObj').mockResolvedValue([{ assetId: 100, value: 1000 }] as any);

      await expect(service.run()).rejects.toThrow(/without a mark/i);

      const flagSet = (settingService.set as jest.Mock).mock.calls.find((c) => c[0] === 'ledgerCutoverLogId');
      expect(flagSet).toBeUndefined(); // ledger-ready flag NOT set → all consumers stay no-op, retry next cron run
      expect(booked.some((b) => b.sourceId === '1557344:manual-debt:100')).toBe(false); // no zero-opening booked
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
    // the ASSET opening sits at its per-asset sourceId `<logId>:asset:<assetId>` seq 0 (B2) → nextSeq already returns 1
    // → alreadyBooked(seq 0) true → no re-book
    nextSeqByKey.set('cutover:1557344:asset:100', 1);

    await service.run();

    expect(booked.some((b) => b.legs.some((l) => l.account.type === AccountType.ASSET))).toBe(false);
  });
});
