import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { createCustomExchangeTx } from 'src/integration/exchange/dto/__mocks__/exchange-tx.entity.mock';
import { ExchangeTx, ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { ExchangeTxService } from 'src/integration/exchange/services/exchange-tx.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { ProcessService } from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { LiquidityManagementPipelineService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-pipeline.service';
import { PaymentBalanceService } from 'src/subdomains/core/payment-link/services/payment-balance.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { createCustomBuyFiat } from 'src/subdomains/core/sell-crypto/process/__mocks__/buy-fiat.entity.mock';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { createCustomSell } from 'src/subdomains/core/sell-crypto/route/__mocks__/sell.entity.mock';
import { TradingOrderService } from 'src/subdomains/core/trading/services/trading-order.service';
import { TradingRuleService } from 'src/subdomains/core/trading/services/trading-rule.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { BankTxRepeatService } from '../../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../../bank-tx/bank-tx-return/bank-tx-return.service';
import { createCustomBankTx } from '../../bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { BankTx, BankTxIndicator, BankTxType } from '../../bank-tx/bank-tx/entities/bank-tx.entity';
import { Bank } from '../../bank/bank/bank.entity';
import { BankService } from '../../bank/bank/bank.service';
import { frickCHF, frickEUR, olkyEUR, yapealCHF } from '../../bank/bank/__mocks__/bank.entity.mock';
import { IbanBankName } from '../../bank/bank/dto/bank.dto';
import { createCustomFiatOutput } from '../../fiat-output/__mocks__/fiat-output.entity.mock';
import { PayInService } from '../../payin/services/payin.service';
import { PayoutService } from '../../payout/services/payout.service';
import { LogJobService } from '../log-job.service';
import { LogService } from '../log.service';

describe('LogJobService', () => {
  let service: LogJobService;

  let tradingRuleService: TradingRuleService;
  let assetService: AssetService;
  let liqManagementBalanceService: LiquidityManagementBalanceService;
  let logService: LogService;
  let payInService: PayInService;
  let buyFiatService: BuyFiatService;
  let buyCryptoService: BuyCryptoService;
  let settingService: SettingService;
  let bankTxService: BankTxService;
  let bankTxRepeatService: BankTxRepeatService;
  let bankTxReturnService: BankTxReturnService;
  let liquidityManagementPipelineService: LiquidityManagementPipelineService;
  let exchangeTxService: ExchangeTxService;
  let bankService: BankService;
  let blockchainRegistryService: BlockchainRegistryService;
  let refRewardService: RefRewardService;
  let tradingOrderService: TradingOrderService;
  let payoutService: PayoutService;
  let processService: ProcessService;
  let paymentBalanceService: PaymentBalanceService;

  beforeEach(async () => {
    tradingRuleService = createMock<TradingRuleService>();
    assetService = createMock<AssetService>();
    liqManagementBalanceService = createMock<LiquidityManagementBalanceService>();
    logService = createMock<LogService>();
    payInService = createMock<PayInService>();
    buyFiatService = createMock<BuyFiatService>();
    buyCryptoService = createMock<BuyCryptoService>();
    settingService = createMock<SettingService>();
    bankTxService = createMock<BankTxService>();
    bankTxRepeatService = createMock<BankTxRepeatService>();
    bankTxReturnService = createMock<BankTxReturnService>();
    liquidityManagementPipelineService = createMock<LiquidityManagementPipelineService>();
    exchangeTxService = createMock<ExchangeTxService>();
    bankService = createMock<BankService>();
    blockchainRegistryService = createMock<BlockchainRegistryService>();
    refRewardService = createMock<RefRewardService>();
    tradingOrderService = createMock<TradingOrderService>();
    payoutService = createMock<PayoutService>();
    processService = createMock<ProcessService>();
    paymentBalanceService = createMock<PaymentBalanceService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        LogJobService,
        { provide: TradingRuleService, useValue: tradingRuleService },
        { provide: AssetService, useValue: assetService },
        { provide: LiquidityManagementBalanceService, useValue: liqManagementBalanceService },
        { provide: LogService, useValue: logService },
        { provide: PayInService, useValue: payInService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: SettingService, useValue: settingService },
        { provide: BankTxService, useValue: bankTxService },
        { provide: BankTxRepeatService, useValue: bankTxRepeatService },
        { provide: BankTxReturnService, useValue: bankTxReturnService },
        { provide: LiquidityManagementPipelineService, useValue: liquidityManagementPipelineService },
        { provide: ExchangeTxService, useValue: exchangeTxService },
        { provide: BankService, useValue: bankService },
        { provide: BlockchainRegistryService, useValue: blockchainRegistryService },
        { provide: RefRewardService, useValue: refRewardService },
        { provide: TradingOrderService, useValue: tradingOrderService },
        { provide: PayoutService, useValue: payoutService },
        { provide: ProcessService, useValue: processService },
        { provide: PaymentBalanceService, useValue: paymentBalanceService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<LogJobService>(LogJobService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getChangeLog (Scrypt & MEXC exchange fees)', () => {
    function setupEmpty() {
      jest.spyOn(buyFiatService, 'getBuyFiat').mockResolvedValue([] as any);
      jest.spyOn(buyCryptoService, 'getBuyCrypto').mockResolvedValue([] as any);
      jest.spyOn(tradingOrderService, 'getTradingOrderYield').mockResolvedValue({ fee: 0, profit: 0 } as any);
      jest.spyOn(payoutService, 'getPayoutOrders').mockResolvedValue([] as any);
      jest.spyOn(bankTxService, 'getBankTxFee').mockResolvedValue(0 as any);
      jest.spyOn(payInService, 'getPayInFee').mockResolvedValue(0 as any);
      jest.spyOn(refRewardService, 'getRefRewardVolume').mockResolvedValue(0 as any);
    }

    it('sums Scrypt and MEXC trade+withdrawal fees (sign-aware, incl. rebates) into minus and total', async () => {
      setupEmpty();
      jest.spyOn(exchangeTxService, 'getExchangeTx').mockResolvedValue([
        // Scrypt: trade 240 minus a 20 rebate = 220 net trading, plus a 10 withdrawal -> total 230
        createCustomExchangeTx({ exchange: ExchangeName.SCRYPT, type: ExchangeTxType.TRADE, feeAmountChf: 240 }),
        createCustomExchangeTx({ exchange: ExchangeName.SCRYPT, type: ExchangeTxType.TRADE, feeAmountChf: -20 }),
        createCustomExchangeTx({ exchange: ExchangeName.SCRYPT, type: ExchangeTxType.WITHDRAWAL, feeAmountChf: 10 }),
        // MEXC: trade 18 + withdrawal 5 -> total 23
        createCustomExchangeTx({ exchange: ExchangeName.MEXC, type: ExchangeTxType.TRADE, feeAmountChf: 18 }),
        createCustomExchangeTx({ exchange: ExchangeName.MEXC, type: ExchangeTxType.WITHDRAWAL, feeAmountChf: 5 }),
      ] as any);

      const result = await (service as any).getChangeLog();

      expect(result.minus.scrypt).toEqual({ total: 230, withdraw: 10, trading: 220 });
      expect(result.minus.mexc).toEqual({ total: 23, withdraw: 5, trading: 18 });
      expect(result.minus.total).toBe(253);
      expect(result.total).toBe(-253);
    });

    it('omits the Scrypt and MEXC blocks when there are no such exchange fees', async () => {
      setupEmpty();
      jest.spyOn(exchangeTxService, 'getExchangeTx').mockResolvedValue([] as any);

      const result = await (service as any).getChangeLog();

      expect(result.minus.scrypt).toBeUndefined();
      expect(result.minus.mexc).toBeUndefined();
    });

    it('flows the bank tx fee into minus.bank and the totals', async () => {
      setupEmpty();
      jest.spyOn(exchangeTxService, 'getExchangeTx').mockResolvedValue([] as any);
      jest.spyOn(bankTxService, 'getBankTxFee').mockResolvedValue(4196 as any);

      const result = await (service as any).getChangeLog();

      expect(result.minus.bank).toBe(4196);
      expect(result.minus.total).toBe(4196);
      expect(result.total).toBe(-4196);
    });
  });

  describe('FinancialChangesLog isolation (reporting failure must not arm the equity safety mode)', () => {
    // a healthy, finite book comfortably above the minimum -> the equity path leaves safety mode off
    function setup() {
      jest.spyOn(service as any, 'getTradingLog').mockResolvedValue({});
      jest.spyOn(service as any, 'getAssetLog').mockResolvedValue({});
      jest
        .spyOn(service as any, 'getBalancesByFinancialType')
        .mockReturnValue({ EUR: { plusBalance: 5000, plusBalanceChf: 5000, minusBalance: 0, minusBalanceChf: 0 } });
      jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([] as any);
      jest.spyOn(settingService, 'getObj').mockResolvedValue(100 as any);
      jest.spyOn(refRewardService, 'getOpenRefCreditLiability').mockResolvedValue({ amountEur: 0, amountChf: 0 });
      jest
        .spyOn(logService, 'maxEntity')
        .mockResolvedValue({ message: JSON.stringify({ balancesTotal: { totalBalanceChf: 5000 } }) } as any);
      jest.spyOn(logService, 'getLatestFinancialLogs').mockResolvedValue([]);
      return jest.spyOn(logService, 'create').mockResolvedValue({} as any);
    }

    it('writes the FinancialDataLog, keeps safety mode off, logs the error and omits the changes entry when getChangeLog throws', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error');
      const createSpy = setup();
      // a transient reporting-price failure while building the changes log
      jest.spyOn(service as any, 'getChangeLog').mockRejectedValue(new Error('No valid price'));

      await service.saveTradingLog();

      // the equity path ran and still persisted the FinancialDataLog entry for this minute
      const dataLog = createSpy.mock.calls.find(([dto]) => dto.subsystem === 'FinancialDataLog');
      expect(dataLog).toBeDefined();

      // the reporting-price failure did NOT arm the equity safety mode: the healthy book set it to false
      // (and the outer catch, which would set it true, never ran)
      expect(processService.setSafetyModeActive).toHaveBeenCalledWith(false);
      expect(processService.setSafetyModeActive).not.toHaveBeenCalledWith(true);

      // the failure is logged and this minute's changes entry is omitted (absence, not a wrong value)
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('financial changes log'), expect.any(Error));
      const changesLog = createSpy.mock.calls.find(([dto]) => dto.subsystem === 'FinancialChangesLog');
      expect(changesLog).toBeUndefined();
    });
  });

  describe('saveTradingLog (referral-credit liability)', () => {
    // a positive base book so the referral-credit assertions work on round numbers
    const baseBuckets = () => ({
      EUR: { plusBalance: 5000, plusBalanceChf: 5000, minusBalance: 0, minusBalanceChf: 0 },
    });

    function setupSaveTradingLog(
      liability: { amountEur: number; amountChf: number },
      buckets: Record<string, unknown> = baseBuckets(),
    ) {
      jest.spyOn(service as any, 'getTradingLog').mockResolvedValue({});
      jest.spyOn(service as any, 'getAssetLog').mockResolvedValue({});
      jest.spyOn(service as any, 'getBalancesByFinancialType').mockReturnValue(buckets);
      jest.spyOn(service as any, 'getChangeLog').mockResolvedValue({});
      jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([] as any);
      jest.spyOn(settingService, 'getObj').mockResolvedValue(100 as any);
      jest.spyOn(refRewardService, 'getOpenRefCreditLiability').mockResolvedValue(liability);
      jest
        .spyOn(logService, 'maxEntity')
        .mockResolvedValue({ message: JSON.stringify({ balancesTotal: { totalBalanceChf: 0 } }) } as any);
      jest.spyOn(logService, 'getLatestFinancialLogs').mockResolvedValue([]);
      return jest.spyOn(logService, 'create').mockResolvedValue({} as any);
    }

    function getFinancialLog(createSpy: jest.SpyInstance) {
      const call = createSpy.mock.calls.find(([dto]) => dto.subsystem === 'FinancialDataLog');
      return JSON.parse(call[0].message);
    }

    it('accrues the open referral-credit liability into minus and reduces the total', async () => {
      const createSpy = setupSaveTradingLog({ amountEur: 1000, amountChf: 920 });

      await service.saveTradingLog();

      const log = getFinancialLog(createSpy);
      expect(log.balancesByFinancialType.RefCredit).toEqual({
        plusBalance: 0,
        plusBalanceChf: 0,
        minusBalance: 1000,
        minusBalanceChf: 920,
      });
      // base book: plus 5000 / minus 0 -> the liability raises minus and lowers total by exactly amountChf
      expect(log.balancesTotal.plusBalanceChf).toBe(5000);
      expect(log.balancesTotal.minusBalanceChf).toBe(920);
      expect(log.balancesTotal.totalBalanceChf).toBe(4080);
    });

    it('writes no RefCredit bucket and leaves the total unchanged when nothing is owed', async () => {
      const createSpy = setupSaveTradingLog({ amountEur: 0, amountChf: 0 });

      await service.saveTradingLog();

      const log = getFinancialLog(createSpy);
      expect(log.balancesByFinancialType.RefCredit).toBeUndefined();
      expect(log.balancesTotal.minusBalanceChf).toBe(0);
      expect(log.balancesTotal.totalBalanceChf).toBe(5000);
    });

    it('sums the liability on top of an existing minus-bearing bucket', async () => {
      // a base book that already carries a real liability, so the ref liability must add to it
      const createSpy = setupSaveTradingLog(
        { amountEur: 1000, amountChf: 920 },
        { BTC: { plusBalance: 10, plusBalanceChf: 10000, minusBalance: 2, minusBalanceChf: 3000 } },
      );

      await service.saveTradingLog();

      const log = getFinancialLog(createSpy);
      // minus: existing 3000 + ref 920 = 3920; total: plus 10000 - 3920 = 6080
      expect(log.balancesTotal.plusBalanceChf).toBe(10000);
      expect(log.balancesTotal.minusBalanceChf).toBe(3920);
      expect(log.balancesTotal.totalBalanceChf).toBe(6080);
    });

    it('persists a negative totalBalanceChf as a real number instead of nulling it to undefined', async () => {
      // a book whose liabilities exceed assets -> genuinely negative total
      const createSpy = setupSaveTradingLog(
        { amountEur: 0, amountChf: 0 },
        { EUR: { plusBalance: 0, plusBalanceChf: 1000, minusBalance: 5000, minusBalanceChf: 5000 } },
      );

      await service.saveTradingLog();

      const log = getFinancialLog(createSpy);
      // must stay numeric so next run's lastTotalBalance is defined and the change-limit comparison
      // (Math.abs(total - last)) does not break on undefined
      expect(log.balancesTotal.totalBalanceChf).toBe(-4000);
      expect(log.balancesTotal.totalBalanceChf).not.toBeUndefined();
    });
  });

  describe('getBalancesByFinancialType (negative aggregates)', () => {
    it('keeps a negative bucket aggregate numeric instead of nulling it to undefined', () => {
      // a bank asset whose reported balance turned negative (e.g. overdrawn/blocked account)
      const asset = createCustomAsset({ id: 1, financialType: 'EUR' });
      const assetLog = {
        1: { plusBalance: { total: -5000 }, minusBalance: { total: 0 }, priceChf: 1 },
      };

      const result = service['getBalancesByFinancialType']([asset], assetLog as any);

      // must stay a real negative number so the downstream sum stays numeric (not NaN)
      expect(result.EUR.plusBalance).toBe(-5000);
      expect(result.EUR.plusBalanceChf).toBe(-5000);
      expect(result.EUR.plusBalance).not.toBeUndefined();
    });
  });

  describe('getFxPnlChf (per-interval price effect of open positions)', () => {
    // a short BTC leg and a long USD leg, priced up and down respectively, plus a non-financialType asset
    // whose price also moves and must therefore be excluded from the FX total.
    const assets = [
      createCustomAsset({ id: 1, financialType: 'BTC' }),
      createCustomAsset({ id: 2, financialType: 'USD' }),
      createCustomAsset({ id: 3 }), // no financialType -> excluded
    ];

    it('sums previous net position times the CHF price change, only over financialType assets', () => {
      const prev = {
        assets: {
          1: { plusBalance: { total: 0 }, minusBalance: { total: 1.7 }, priceChf: 50000 }, // net short 1.7 BTC
          2: { plusBalance: { total: 250000 }, minusBalance: { total: 0 }, priceChf: 0.9 }, // net long 250k USD
          3: { plusBalance: { total: 1000 }, minusBalance: { total: 0 }, priceChf: 10 }, // excluded (no financialType)
        },
      } as any;
      const assetLog = {
        1: { priceChf: 51000 }, // +1000 -> short leg marks down -1700
        2: { priceChf: 0.88 }, // -0.02 -> long leg marks down -5000
        3: { priceChf: 1000 }, // large move, but must not count
      } as any;

      // -1.7 * (51000 - 50000) + 250000 * (0.88 - 0.90) = -1700 + -5000 = -6700; asset 3 filtered out
      expect(service['getFxPnlChf'](prev, assetLog, assets)).toBeCloseTo(-6700, 4);
    });

    it('returns undefined when there is no predecessor snapshot to diff against (first entry)', () => {
      expect(service['getFxPnlChf'](undefined, {} as any, assets)).toBeUndefined();
      // a predecessor log without an assets map is equally unusable as a reference point
      expect(service['getFxPnlChf']({ balancesTotal: {} } as any, {} as any, assets)).toBeUndefined();
    });

    it('ignores positions absent from either snapshot (new and closed positions carry no price effect)', () => {
      const prev = {
        assets: {
          1: { plusBalance: { total: 2 }, minusBalance: { total: 0 }, priceChf: 50000 }, // present both sides
          2: { plusBalance: { total: 100 }, minusBalance: { total: 0 }, priceChf: 10 }, // closed: gone from current
        },
      } as any;
      const assetLog = {
        1: { priceChf: 50100 }, // +100 -> 2 * 100 = 200
        4: { priceChf: 999 }, // new position: not in prev -> ignored
      } as any;
      const withNewAndClosed = [
        createCustomAsset({ id: 1, financialType: 'BTC' }),
        createCustomAsset({ id: 2, financialType: 'BTC' }), // closed since the previous snapshot
        createCustomAsset({ id: 4, financialType: 'BTC' }), // newly entered
      ];

      // only asset 1 is in both snapshots: 2 * (50100 - 50000) = 200
      expect(service['getFxPnlChf'](prev, assetLog, withNewAndClosed)).toBeCloseTo(200, 4);
    });

    it('skips an asset without a usable price on either side', () => {
      const prev = {
        assets: {
          1: { plusBalance: { total: 2 }, minusBalance: { total: 0 }, priceChf: undefined }, // no previous price
          2: { plusBalance: { total: 2 }, minusBalance: { total: 0 }, priceChf: 100 },
        },
      } as any;
      const assetLog = {
        1: { priceChf: 100 },
        2: { priceChf: undefined }, // no current price
      } as any;
      const twoAssets = [
        createCustomAsset({ id: 1, financialType: 'BTC' }),
        createCustomAsset({ id: 2, financialType: 'BTC' }),
      ];

      expect(service['getFxPnlChf'](prev, assetLog, twoAssets)).toBe(0);
    });
  });

  describe('saveTradingLog (FX P&L component)', () => {
    function setupFxPnl(params: { assets: Asset[]; assetLog: Record<number, unknown>; lastMessage: object }) {
      jest.spyOn(service as any, 'getTradingLog').mockResolvedValue({});
      jest.spyOn(service as any, 'getAssetLog').mockResolvedValue(params.assetLog);
      // mock the bucket aggregation so the FX assertion is isolated from balance summation; a healthy
      // finite total keeps safety mode and the valid flag out of the way.
      jest.spyOn(service as any, 'getBalancesByFinancialType').mockReturnValue({
        BTC: { plusBalance: 0, plusBalanceChf: 200000, minusBalance: 0, minusBalanceChf: 0 },
      });
      jest.spyOn(service as any, 'getChangeLog').mockResolvedValue({});
      jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue(params.assets as any);
      jest.spyOn(settingService, 'getObj').mockResolvedValue(100 as any);
      jest.spyOn(refRewardService, 'getOpenRefCreditLiability').mockResolvedValue({ amountEur: 0, amountChf: 0 });
      jest
        .spyOn(logService, 'maxEntity')
        .mockResolvedValue({ created: new Date(), message: JSON.stringify(params.lastMessage) } as any);
      jest.spyOn(logService, 'getLatestFinancialLogs').mockResolvedValue([]);
      return jest.spyOn(logService, 'create').mockResolvedValue({} as any);
    }

    function financialLog(createSpy: jest.SpyInstance) {
      const call = createSpy.mock.calls.find(([dto]) => dto.subsystem === 'FinancialDataLog');
      return JSON.parse(call[0].message);
    }

    it('writes the price effect of the open positions since the previous snapshot into balancesTotal', async () => {
      const createSpy = setupFxPnl({
        assets: [
          createCustomAsset({ id: 1, financialType: 'BTC' }),
          createCustomAsset({ id: 2, financialType: 'USD' }),
        ],
        assetLog: {
          1: { priceChf: 51000, plusBalance: { total: 0 }, minusBalance: { total: 1.7 } },
          2: { priceChf: 0.88, plusBalance: { total: 250000 }, minusBalance: { total: 0 } },
        },
        lastMessage: {
          balancesTotal: { totalBalanceChf: 200000 },
          assets: {
            1: { plusBalance: { total: 0 }, minusBalance: { total: 1.7 }, priceChf: 50000 },
            2: { plusBalance: { total: 250000 }, minusBalance: { total: 0 }, priceChf: 0.9 },
          },
        },
      });

      await service.saveTradingLog();

      // -1.7*(51000-50000) + 250000*(0.88-0.90) = -1700 + -5000 = -6700 (rounded to 2 dp, negative preserved)
      expect(financialLog(createSpy).balancesTotal.fxPnlChf).toBe(-6700);
    });

    it('omits fxPnlChf when the previous snapshot has no assets to diff against (first entry)', async () => {
      const createSpy = setupFxPnl({
        assets: [createCustomAsset({ id: 1, financialType: 'BTC' })],
        assetLog: { 1: { priceChf: 51000, plusBalance: { total: 1 }, minusBalance: { total: 0 } } },
        lastMessage: { balancesTotal: { totalBalanceChf: 200000 } }, // no assets map -> no reference point
      });

      await service.saveTradingLog();

      expect(financialLog(createSpy).balancesTotal).not.toHaveProperty('fxPnlChf');
    });
  });

  describe('safety mode (fail closed on non-finite total)', () => {
    function setup(buckets: Record<string, unknown>, minTotalBalanceChf: number) {
      jest.spyOn(service as any, 'getTradingLog').mockResolvedValue({});
      jest.spyOn(service as any, 'getAssetLog').mockResolvedValue({});
      jest.spyOn(service as any, 'getBalancesByFinancialType').mockReturnValue(buckets);
      jest.spyOn(service as any, 'getChangeLog').mockResolvedValue({});
      jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([] as any);
      jest.spyOn(settingService, 'getObj').mockResolvedValue(minTotalBalanceChf as any);
      jest.spyOn(refRewardService, 'getOpenRefCreditLiability').mockResolvedValue({ amountEur: 0, amountChf: 0 });
      jest
        .spyOn(logService, 'maxEntity')
        .mockResolvedValue({ message: JSON.stringify({ balancesTotal: { totalBalanceChf: 0 } }) } as any);
      jest.spyOn(logService, 'getLatestFinancialLogs').mockResolvedValue([]);
      jest.spyOn(logService, 'create').mockResolvedValue({} as any);
    }

    it('activates safety mode and logs an error when the total is not finite', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error');
      // an unsummable bucket (undefined chf) makes the summed total NaN -> non-finite
      setup({ EUR: { plusBalance: 0, plusBalanceChf: undefined, minusBalance: 0, minusBalanceChf: 0 } }, 100000);

      await service.saveTradingLog();

      expect(processService.setSafetyModeActive).toHaveBeenCalledWith(true);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not finite'));
    });

    it('activates safety mode and logs an error when the minimum threshold is not finite', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error');
      // a healthy finite total but a misconfigured (non-finite) threshold must still fail closed:
      // `total < NaN` is always false, so the safety net would otherwise stay silently disabled
      setup({ EUR: { plusBalance: 5000, plusBalanceChf: 5000, minusBalance: 0, minusBalanceChf: 0 } }, NaN);

      await service.saveTradingLog();

      expect(processService.setSafetyModeActive).toHaveBeenCalledWith(true);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('minTotalBalanceChf is not finite'));
    });

    it('never marks a non-finite total as valid, even when the last valid entry is old', async () => {
      setup({ EUR: { plusBalance: 0, plusBalanceChf: undefined, minusBalance: 0, minusBalanceChf: 0 } }, 100000);
      // last valid entry is stale (1h ago); there is no time-based validation path, so age alone never validates
      jest.spyOn(logService, 'maxEntity').mockResolvedValue({
        created: new Date(Date.now() - 60 * 60 * 1000),
        message: JSON.stringify({ balancesTotal: { totalBalanceChf: 0 } }),
      } as any);

      await service.saveTradingLog();

      const financialLog = (logService.create as jest.Mock).mock.calls.find(
        ([entry]) => entry.subsystem === 'FinancialDataLog',
      )?.[0];
      expect(financialLog.valid).toBe(false);
    });

    it('activates safety mode when the finite total is below the minimum', async () => {
      setup({ EUR: { plusBalance: 5000, plusBalanceChf: 5000, minusBalance: 0, minusBalanceChf: 0 } }, 100000);

      await service.saveTradingLog();

      expect(processService.setSafetyModeActive).toHaveBeenCalledWith(true);
    });

    it('leaves safety mode inactive when the finite total meets the minimum', async () => {
      setup({ EUR: { plusBalance: 5000, plusBalanceChf: 5000, minusBalance: 0, minusBalanceChf: 0 } }, 5000);

      await service.saveTradingLog();

      expect(processService.setSafetyModeActive).toHaveBeenCalledWith(false);
    });
  });

  describe('valid flag (change-limit and stability-window interaction, #4312)', () => {
    // drive saveTradingLog with a controllable current book, last VALID entry, and immediate predecessor
    // snapshots (newest first, mirroring LogService.getLatestFinancialLogs), then read the FinancialDataLog
    // `valid` flag and its balancesTotal.validatedByStability marker. `predecessors` defaults to an empty
    // array (cold start / insufficient history), under which the stability path can never fire and the
    // change-limit-vs-baseline check alone decides validity.
    function setup(
      buckets: Record<string, unknown>,
      lastTotalBalanceChf: number,
      createdMinutesAgo: number,
      predecessors: unknown[] = [],
    ) {
      jest.spyOn(service as any, 'getTradingLog').mockResolvedValue({});
      jest.spyOn(service as any, 'getAssetLog').mockResolvedValue({});
      jest.spyOn(service as any, 'getBalancesByFinancialType').mockReturnValue(buckets);
      jest.spyOn(service as any, 'getChangeLog').mockResolvedValue({});
      jest.spyOn(assetService, 'getAssetsWith').mockResolvedValue([] as any);
      jest.spyOn(settingService, 'getObj').mockResolvedValue(100000 as any);
      jest.spyOn(refRewardService, 'getOpenRefCreditLiability').mockResolvedValue({ amountEur: 0, amountChf: 0 });
      jest.spyOn(logService, 'maxEntity').mockResolvedValue({
        created: new Date(Date.now() - createdMinutesAgo * 60 * 1000),
        message: JSON.stringify({ balancesTotal: { totalBalanceChf: lastTotalBalanceChf } }),
      } as any);
      jest.spyOn(logService, 'getLatestFinancialLogs').mockResolvedValue(predecessors as any);
      return jest.spyOn(logService, 'create').mockResolvedValue({} as any);
    }

    // builds a mock predecessor Log whose parsed FinanceLog.balancesTotal.totalBalanceChf is `totalBalanceChf`
    function predecessor(totalBalanceChf: number | null) {
      return { message: JSON.stringify({ balancesTotal: { totalBalanceChf } }) };
    }

    function dataLogDto(createSpy: jest.SpyInstance) {
      return createSpy.mock.calls.find(([dto]) => dto.subsystem === 'FinancialDataLog')?.[0];
    }

    function financialLog(createSpy: jest.SpyInstance) {
      return JSON.parse(dataLogDto(createSpy).message);
    }

    function validFlag(createSpy: jest.SpyInstance): boolean {
      return dataLogDto(createSpy).valid;
    }

    // book totalling -4000 (plus 1000, minus 5000), i.e. a genuinely negative equity on both sides
    const negativeBook = () => ({
      EUR: { plusBalance: 0, plusBalanceChf: 1000, minusBalance: 5000, minusBalanceChf: 5000 },
    });

    // book totalling `total` on the plus side only (no minus), for the stability-window scenarios below
    const bookOf = (total: number) => ({
      EUR: { plusBalance: 0, plusBalanceChf: total, minusBalance: 0, minusBalanceChf: 0 },
    });

    it('validates a negative-to-negative move that stays under the change limit', async () => {
      // total -4000 vs last -4500 -> |diff| 500 <= 5000 limit -> valid even though both totals are negative
      const createSpy = setup(negativeBook(), -4500, 1);

      await service.saveTradingLog();

      expect(validFlag(createSpy)).toBe(true);
    });

    it('invalidates a positive-to-negative jump over the change limit with no predecessor history', async () => {
      // total -4000 vs last +50000 -> |diff| 54000 > 5000 limit; no predecessors -> stability path cannot
      // fire either -> not valid
      const createSpy = setup(negativeBook(), 50000, 1);

      await service.saveTradingLog();

      expect(validFlag(createSpy)).toBe(false);
    });

    it('normal drift stays valid with no validatedByStability marker', async () => {
      // total 102000 vs baseline 100000 -> |diff| 2000 <= 5000 limit -> valid via the baseline path, not stability
      const createSpy = setup(bookOf(102000), 100000, 1);

      await service.saveTradingLog();

      expect(validFlag(createSpy)).toBe(true);
      expect(financialLog(createSpy).balancesTotal).not.toHaveProperty('validatedByStability');
    });

    it('a lone transient spike stays invalid (predecessors all still at the old level)', async () => {
      // total 110000 vs baseline 100000 -> |diff| 10000 > 5000 limit; all 4 predecessors are still at 100000,
      // so the 5-value window band is 10000 > 5000 -> not a stable plateau -> invalid
      const createSpy = setup(bookOf(110000), 100000, 1, [
        predecessor(100000),
        predecessor(100000),
        predecessor(100000),
        predecessor(100000),
      ]);

      await service.saveTradingLog();

      expect(validFlag(createSpy)).toBe(false);
    });

    it('a 2-minute spike (only 2 of 5 window values at the new level) stays invalid', async () => {
      // window = [current=spike, predecessor=spike, base, base, base]; band = spike - base > 5000 -> invalid
      const createSpy = setup(bookOf(110000), 100000, 1, [
        predecessor(110000),
        predecessor(100000),
        predecessor(100000),
        predecessor(100000),
      ]);

      await service.saveTradingLog();

      expect(validFlag(createSpy)).toBe(false);
    });

    it('a stable new plateau is adopted as valid and tagged validatedByStability', async () => {
      // total 110000 vs baseline 100000 -> |diff| 10000 > 5000 limit (not near baseline), but the current
      // total plus all 4 predecessors sit within a 2000-wide band (108000..110000) -> stable plateau -> valid
      const createSpy = setup(bookOf(110000), 100000, 1, [
        predecessor(109000),
        predecessor(108500),
        predecessor(109500),
        predecessor(108000),
      ]);

      await service.saveTradingLog();

      expect(logService.getLatestFinancialLogs).toHaveBeenCalledWith(Config.financeLogStabilityWindow - 1);
      expect(validFlag(createSpy)).toBe(true);
      expect(financialLog(createSpy).balancesTotal.validatedByStability).toBe(true);
    });

    it('a returned-true value re-validates against a stale bad baseline via its own predecessors', async () => {
      // last VALID entry is a stale bad level (200000), but the current total (100000) plus all 4
      // predecessors form their own stable plateau (98500..100500, a 2000-wide band) at the true level ->
      // valid via stability, proving the predecessor plateau (not the stale baseline) drives adoption
      const createSpy = setup(bookOf(100000), 200000, 1, [
        predecessor(99500),
        predecessor(100500),
        predecessor(98500),
        predecessor(99000),
      ]);

      await service.saveTradingLog();

      expect(validFlag(createSpy)).toBe(true);
      expect(financialLog(createSpy).balancesTotal.validatedByStability).toBe(true);
    });

    it('cold start / insufficient predecessor history near baseline still validates', async () => {
      // only 2 of the required 4 predecessors exist -> the 5-value stability window can never fill ->
      // isStablePlateau is always false -> validity depends purely on the near-baseline check
      const createSpy = setup(bookOf(102000), 100000, 1, [predecessor(102000), predecessor(102000)]);

      await service.saveTradingLog();

      expect(validFlag(createSpy)).toBe(true); // |diff| 2000 <= 5000 -> near baseline -> valid
    });

    it('cold start / insufficient predecessor history far from baseline stays invalid', async () => {
      // only 2 of the required 4 predecessors exist -> the 5-value stability window can never fill ->
      // isStablePlateau is always false -> validity depends purely on the near-baseline check
      const createSpy = setup(bookOf(110000), 100000, 1, [predecessor(110000), predecessor(110000)]);

      await service.saveTradingLog();

      expect(validFlag(createSpy)).toBe(false); // |diff| 10000 > 5000 and stability can't fire -> invalid
    });

    it('a non-finite total is never valid, regardless of predecessors (regression)', async () => {
      // an unsummable bucket (undefined chf) makes the summed total NaN -> non-finite; predecessors would
      // otherwise form a plateau, but totalBalanceIsFinite must still gate the whole expression
      const createSpy = setup(
        { EUR: { plusBalance: 0, plusBalanceChf: undefined, minusBalance: 0, minusBalanceChf: 0 } },
        100000,
        1,
        [predecessor(100000), predecessor(100000), predecessor(100000), predecessor(100000)],
      );

      await service.saveTradingLog();

      expect(validFlag(createSpy)).toBe(false);
      expect(financialLog(createSpy).balancesTotal).not.toHaveProperty('validatedByStability');
    });

    it('a non-finite predecessor total blocks stability adoption', async () => {
      // total 110000 vs baseline 100000 -> jump > 5000 limit; 3 predecessors near 110000 but one predecessor
      // total is non-finite (null) -> the plateau can never be confirmed -> invalid
      const createSpy = setup(bookOf(110000), 100000, 1, [
        predecessor(109000),
        predecessor(null),
        predecessor(109500),
        predecessor(108500),
      ]);

      await service.saveTradingLog();

      expect(validFlag(createSpy)).toBe(false);
    });

    it('a plateau band exactly at the change limit (boundary) is adopted as valid', async () => {
      // stability window [110000, 108000, 107000, 106000, 105000] -> max-min = 5000 exactly (<= limit);
      // |110000 - 100000| = 10000 > 5000 so not near-baseline -> adopted purely via the inclusive stability path
      const createSpy = setup(bookOf(110000), 100000, 1, [
        predecessor(108000),
        predecessor(107000),
        predecessor(106000),
        predecessor(105000),
      ]);

      await service.saveTradingLog();

      expect(validFlag(createSpy)).toBe(true);
      expect(financialLog(createSpy).balancesTotal.validatedByStability).toBe(true);
    });
  });

  it('should filter same length sender & receiver', async () => {
    if (new Date().getHours() > 19) return;

    // Items 0-6 are > 21 days old (will be filtered out), items 7-9 are < 21 days (will remain)
    const receiverTx = [
      createCustomExchangeTx({ id: 63189, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63190, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63191, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63232, created: Util.hoursBefore(527), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63277, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63278, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63279, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63280, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
      createCustomExchangeTx({ id: 63281, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
      createCustomExchangeTx({ id: 63282, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
    ];

    const senderTx = [
      createCustomBankTx({
        id: 142006,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142007,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142008,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142153,
        created: Util.hoursBefore(528), // 22d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142199,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142218,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142265,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142396,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142407,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142408,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142409,
        created: Util.hoursBefore(309), // 13d
        valueDate: Util.hoursBefore(309),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: senderTx.slice(7),
      receiver: receiverTx.slice(7),
    });
  });

  it('should return an empty array', async () => {
    expect(service.filterSenderPendingList([], [])).toMatchObject({ receiver: [], sender: [] });
  });

  it('should return sender & receiver', async () => {
    const senderTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(27), amount: 9999.0 })];

    const receiverTx = [
      createCustomBankTx({
        id: 1,
        created: Util.hoursBefore(26),
        valueDate: Util.hoursBefore(26),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: senderTx,
      receiver: receiverTx,
    });
  });

  it('should filter not matching older senderTx', async () => {
    const senderTx = [
      createCustomExchangeTx({ id: 1, created: Util.daysBefore(8), amount: 9999.0 }),
      createCustomExchangeTx({ id: 2, created: Util.daysBefore(8), amount: 9999.0 }),
      createCustomExchangeTx({ id: 3, created: Util.daysBefore(7), amount: 9999.0 }),
    ];

    const receiverTx = [
      createCustomBankTx({
        id: 1,
        created: Util.daysBefore(6),
        valueDate: Util.daysBefore(6),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
      createCustomBankTx({
        id: 2,
        created: Util.daysBefore(5),
        valueDate: Util.daysBefore(5),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
      createCustomBankTx({
        id: 3,
        created: Util.daysBefore(5),
        valueDate: Util.daysBefore(5),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [senderTx[2]],
      receiver: [receiverTx[2]],
    });
  });

  it('should filter tx 21d or older', async () => {
    const senderTx = [
      createCustomExchangeTx({ id: 1, created: Util.daysBefore(22), amount: 9999.0 }),
      createCustomExchangeTx({ id: 2, created: Util.daysBefore(17), amount: 9999.0 }),
      createCustomExchangeTx({ id: 3, created: Util.daysBefore(7), amount: 9999.0 }),
    ];

    const receiverTx = [
      createCustomBankTx({
        id: 1,
        created: Util.daysBefore(21),
        valueDate: Util.daysBefore(21),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
      createCustomBankTx({
        id: 2,
        created: Util.daysBefore(16),
        valueDate: Util.daysBefore(16),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
      createCustomBankTx({
        id: 3,
        created: Util.daysBefore(6),
        valueDate: Util.daysBefore(6),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: senderTx.slice(1),
      receiver: receiverTx.slice(1),
    });
  });

  it('should filter tx 21d or older', async () => {
    const senderTx = [
      createCustomExchangeTx({ id: 1, created: Util.daysBefore(21), amount: 47543.81 }),
      createCustomExchangeTx({ id: 2, created: Util.daysBefore(17), amount: 19999.0 }),
    ];

    const receiverTx = [
      createCustomBankTx({
        id: 1,
        created: Util.daysBefore(20),
        valueDate: Util.daysBefore(20),
        instructedAmount: 47543.81,
        amount: 47520.04,
      }),
      createCustomBankTx({
        id: 2,
        created: Util.daysBefore(16),
        valueDate: Util.daysBefore(16),
        instructedAmount: 19999.0,
        amount: 19989.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [senderTx[1]],
      receiver: [receiverTx[1]],
    });
  });

  it('should filter receiver 21d or older', async () => {
    // All senders created after receiver, so matching finds sender with highest id
    const senderTx = [
      createCustomExchangeTx({ id: 3, created: Util.daysBefore(20), amount: 9999.0 }),
      createCustomExchangeTx({ id: 2, created: Util.daysBefore(19), amount: 9999.0 }),
      createCustomExchangeTx({ id: 1, created: Util.daysBefore(19), amount: 9999.0 }),
    ];

    const receiverTx = [
      createCustomBankTx({
        id: 1,
        created: Util.daysBefore(21), // This will be filtered out (>= 21d)
        valueDate: Util.daysBefore(21),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
      createCustomBankTx({
        id: 2,
        created: Util.daysBefore(18), // This will remain (< 21d)
        valueDate: Util.daysBefore(18),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
    ];

    // Matching finds sender id=3 (oldest sender that's still older than receiver at 18d)
    // Filter keeps only senders with id >= 3
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [senderTx[0]], // Only id=3 remains after matching
      receiver: [receiverTx[1]],
    });
  });

  it('should filter same length sender & receiver (reverse)', async () => {
    if (new Date().getHours() > 19) return;

    // Items 0-6 are > 21 days old (will be filtered out), items 7-9 are < 21 days (will remain)
    const receiverTx = [
      createCustomExchangeTx({ id: 63189, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63190, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63191, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63232, created: Util.hoursBefore(527), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63277, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63278, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63279, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63280, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
      createCustomExchangeTx({ id: 63281, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
      createCustomExchangeTx({ id: 63282, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
    ];

    const senderTx = [
      createCustomBankTx({
        id: 142006,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142007,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142008,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142153,
        created: Util.hoursBefore(528), // 22d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142199,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142218,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142265,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142396,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142407,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142408,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: senderTx.slice(7),
      receiver: receiverTx.slice(7),
    });
  });

  // --- getUnmatchedSenders (reference-based matching via payout ID or free-text reference) ---

  it('should match sender and receiver by numeric reference ID', () => {
    const senderTx = [createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: 'DFX Payout 80100' })];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: 'DEPOSIT-80100' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual([]);
  });

  it('should return sender when numeric reference IDs do not match', () => {
    const senderTx = [createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: 'DFX Payout 80100' })];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: 'DEPOSIT-80200' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual(senderTx);
  });

  it('should return sender when sender has no reference', () => {
    const senderTx = [createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: undefined })];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: 'DEPOSIT-80100' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual(senderTx);
  });

  it('should return sender when receiver has no reference', () => {
    const senderTx = [createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: 'DFX Payout 80100' })];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: undefined })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual(senderTx);
  });

  it('should filter out senders older than 7 days', () => {
    const senderTx = [
      createCustomBankTx({ id: 1, created: Util.hoursBefore(200), remittanceInfo: 'DFX Payout 80100' }),
    ];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: 'DEPOSIT-80200' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual([]);
  });

  it('should return all senders when receiver list is empty', () => {
    const senderTx = [
      createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: 'DFX Payout 80100' }),
      createCustomBankTx({ id: 2, created: Util.hoursBefore(24), remittanceInfo: 'DFX Payout 80200' }),
    ];

    expect(service.getUnmatchedSenders(senderTx, [])).toEqual(senderTx);
  });

  it('should match multiple senders partially', () => {
    const senderTx = [
      createCustomBankTx({ id: 1, created: Util.hoursBefore(48), remittanceInfo: 'DFX Payout 80100' }),
      createCustomBankTx({ id: 2, created: Util.hoursBefore(24), remittanceInfo: 'DFX Payout 80200' }),
    ];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: 'DEPOSIT-80100' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual([senderTx[1]]);
  });

  it('should match ExchangeTx senders by txId against BankTx receivers by remittanceInfo', () => {
    const senderTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(24), txId: 'WITHDRAWAL-50050' })];
    const receiverTx = [
      createCustomBankTx({ id: 1, created: Util.hoursBefore(20), remittanceInfo: 'DFX Payout 50050' }),
    ];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual([]);
  });

  it('should match manual transfers by identical free-text reference ending in a letter', () => {
    const senderTx = [createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: '12.06.2026.A' })];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: '12.06.2026.A' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual([]);
  });

  it('should not match different manual free-text references against each other', () => {
    const senderTx = [
      createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: '12.06.2026.A', amount: 50000 }),
    ];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: '12.06.2026.B' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual(senderTx);
  });

  it('should not match an ambiguous single-digit suffix against a payout ID receiver', () => {
    const senderTx = [createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: '12.06.2026, 1' })];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: 'DEPOSIT-80001' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual(senderTx);
  });

  it('should match manual transfers with identical reference containing a single-digit suffix', () => {
    const senderTx = [createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: '12.06.2026, 1' })];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: '12.06.2026, 1' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual([]);
  });

  it('should NOT match date references sharing the same trailing year across unrelated transfers', () => {
    // Critical: with the old /(\d{4,})$/ logic both collapse to "2026" and the in-transit
    // sender would be falsely treated as arrived, silently hiding the money.
    const senderTx = [
      createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: '21.05.2026', amount: 570000 }),
    ];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: '08.06.2026' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual(senderTx);
  });

  it('should match date references when identical on both sides', () => {
    const senderTx = [createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: '21.05.2026' })];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: '21.05.2026' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual([]);
  });

  it('should match automated payout id across E2E receiver format', () => {
    const senderTx = [createCustomBankTx({ id: 1, created: Util.hoursBefore(24), remittanceInfo: 'DFX Payout 80100' })];
    const receiverTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(20), txId: 'E2E-80100' })];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual([]);
  });

  // --- getUnmatchedSenders pass-2: amount+date fallback for ref-less receivers ---

  it('should retire ref-less ok Scrypt EUR deposits by amount+date (bug #4311)', () => {
    // Production bug: arrived Scrypt deposits with empty txId never entered receiverRefs,
    // so their bank senders stayed in the toScrypt pending bucket until the 7-day cutoff.
    const senderTx = [
      createCustomBankTx({
        id: 1,
        created: Util.hoursBefore(48),
        valueDate: Util.hoursBefore(48),
        instructedAmount: 30000,
        instructedCurrency: 'EUR',
        remittanceInfo: 'manual transfer A',
      }),
      createCustomBankTx({
        id: 2,
        created: Util.hoursBefore(36),
        valueDate: Util.hoursBefore(36),
        instructedAmount: 70000,
        instructedCurrency: 'EUR',
        remittanceInfo: 'manual transfer B',
      }),
      createCustomBankTx({
        id: 3,
        created: Util.hoursBefore(24),
        valueDate: Util.hoursBefore(24),
        instructedAmount: 50015.06,
        instructedCurrency: 'EUR',
        remittanceInfo: 'manual transfer C',
      }),
    ];
    const receiverTx = [
      createCustomExchangeTx({
        id: 1,
        created: Util.hoursBefore(40),
        amount: 30000,
        currency: 'EUR',
        txId: undefined,
      }),
      createCustomExchangeTx({
        id: 2,
        created: Util.hoursBefore(30),
        amount: 70000,
        currency: 'EUR',
        txId: undefined,
      }),
    ];

    // Pending bucket 150015.06 correctly becomes 50015.06 after pass-2 matching.
    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual([senderTx[2]]);
  });

  it('should still match by payout-id reference when a ref-less receiver is also present', () => {
    // Pass 1 and pass 2 coexist: reference match retires one pair; amount match retires another.
    const senderTx = [
      createCustomBankTx({
        id: 1,
        created: Util.hoursBefore(48),
        valueDate: Util.hoursBefore(48),
        instructedAmount: 10000,
        instructedCurrency: 'EUR',
        remittanceInfo: 'DFX Payout 90100',
      }),
      createCustomBankTx({
        id: 2,
        created: Util.hoursBefore(24),
        valueDate: Util.hoursBefore(24),
        instructedAmount: 20000,
        instructedCurrency: 'EUR',
        remittanceInfo: 'manual no match',
      }),
      createCustomBankTx({
        id: 3,
        created: Util.hoursBefore(12),
        valueDate: Util.hoursBefore(12),
        instructedAmount: 99999,
        instructedCurrency: 'EUR',
        remittanceInfo: 'still in transit',
      }),
    ];
    const receiverTx = [
      createCustomExchangeTx({
        id: 1,
        created: Util.hoursBefore(40),
        amount: 10000,
        currency: 'EUR',
        txId: 'DEPOSIT-90100',
      }),
      createCustomExchangeTx({
        id: 2,
        created: Util.hoursBefore(20),
        amount: 20000,
        currency: 'EUR',
        txId: undefined,
      }),
    ];

    // Sender 1 retired by pass 1 (payout id), sender 2 by pass 2 (amount), sender 3 stays.
    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual([senderTx[2]]);
  });

  it('should consume each ref-less receiver at most once for equal amounts', () => {
    const senderTx = [
      createCustomBankTx({
        id: 1,
        created: Util.hoursBefore(48),
        valueDate: Util.hoursBefore(48),
        instructedAmount: 50000,
        instructedCurrency: 'EUR',
        remittanceInfo: 'sender one',
      }),
      createCustomBankTx({
        id: 2,
        created: Util.hoursBefore(24),
        valueDate: Util.hoursBefore(24),
        instructedAmount: 50000,
        instructedCurrency: 'EUR',
        remittanceInfo: 'sender two',
      }),
    ];
    const receiverTx = [
      createCustomExchangeTx({
        id: 1,
        created: Util.hoursBefore(36),
        amount: 50000,
        currency: 'EUR',
        txId: undefined,
      }),
    ];

    const unmatched = service.getUnmatchedSenders(senderTx, receiverTx);
    expect(unmatched).toHaveLength(1);
    expect(senderTx).toContain(unmatched[0]);
  });

  it('should not match when amount difference exceeds tolerance', () => {
    // Tolerance for 30000 is max(1, 0.01*30000) = 300; 500 is beyond that.
    const senderTx = [
      createCustomBankTx({
        id: 1,
        created: Util.hoursBefore(24),
        valueDate: Util.hoursBefore(24),
        instructedAmount: 30000,
        instructedCurrency: 'EUR',
        remittanceInfo: 'no amount match',
      }),
    ];
    const receiverTx = [
      createCustomExchangeTx({
        id: 1,
        created: Util.hoursBefore(20),
        amount: 30500,
        currency: 'EUR',
        txId: undefined,
      }),
    ];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual(senderTx);
  });

  it('should not match when date difference exceeds the 7-day window', () => {
    // ~8 days apart — outside the pass-2 date window (and sender still recent via created).
    const senderTx = [
      createCustomBankTx({
        id: 1,
        created: Util.hoursBefore(24),
        valueDate: Util.hoursBefore(24),
        instructedAmount: 30000,
        instructedCurrency: 'EUR',
        remittanceInfo: 'date too far',
      }),
    ];
    const receiverTx = [
      createCustomExchangeTx({
        id: 1,
        created: Util.hoursBefore(24 + 8 * 24),
        amount: 30000,
        currency: 'EUR',
        txId: undefined,
      }),
    ];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual(senderTx);
  });

  it('should not match across different currencies even when amount and date align', () => {
    const senderTx = [
      createCustomBankTx({
        id: 1,
        created: Util.hoursBefore(24),
        valueDate: Util.hoursBefore(24),
        instructedAmount: 30000,
        instructedCurrency: 'EUR',
        remittanceInfo: 'eur sender',
      }),
    ];
    const receiverTx = [
      createCustomExchangeTx({
        id: 1,
        created: Util.hoursBefore(20),
        amount: 30000,
        currency: 'CHF',
        txId: undefined,
      }),
    ];

    expect(service.getUnmatchedSenders(senderTx, receiverTx)).toEqual(senderTx);
  });

  it('should return the same result regardless of input array order (determinism, bug #4311 follow-up)', () => {
    // senderOld and senderNew both compete for receiverX (their best amount-diff match).
    // senderOld can ONLY match receiverX (amount too far from receiverY, outside 1% tolerance).
    // senderNew can match BOTH receiverX and receiverY, with receiverX being its best match too.
    // A processing order that is not sorted by transfer-date could let senderNew grab receiverX
    // first, stranding senderOld (which has no fallback) unmatched — an order-dependent result.
    // The deterministic date-ascending processing order always processes senderOld first, so
    // senderOld claims receiverX and senderNew falls back to receiverY: both retired, every time,
    // regardless of input array order.
    const senderOld = createCustomBankTx({
      id: 301,
      created: Util.hoursBefore(48),
      valueDate: Util.hoursBefore(48),
      instructedAmount: 49700,
      instructedCurrency: 'EUR',
      remittanceInfo: 'det sender old',
    });
    const senderNew = createCustomBankTx({
      id: 302,
      created: Util.hoursBefore(24),
      valueDate: Util.hoursBefore(24),
      instructedAmount: 50300,
      instructedCurrency: 'EUR',
      remittanceInfo: 'det sender new',
    });
    const receiverX = createCustomExchangeTx({
      id: 401,
      created: Util.hoursBefore(36),
      amount: 50000,
      currency: 'EUR',
      txId: undefined,
    });
    const receiverY = createCustomExchangeTx({
      id: 402,
      created: Util.hoursBefore(12),
      amount: 50700,
      currency: 'EUR',
      txId: undefined,
    });

    const forward = service.getUnmatchedSenders([senderOld, senderNew], [receiverX, receiverY]);
    const reversed = service.getUnmatchedSenders([senderNew, senderOld], [receiverY, receiverX]);

    expect(forward).toEqual([]);
    expect(reversed).toEqual([]);
    expect(reversed).toEqual(forward);
  });

  it('should prefer the exact amount match over an earlier near match (global assignment)', () => {
    // Repro of the local-greedy date-order defect: senderA (older, 20100) is within
    // tolerance of a ref-less 20000 receiver (diff 100 <= 201) and would grab it first
    // under date-ascending processing, stranding senderB (exact 20000 match). Global
    // candidate sort by amountDiff first retires senderB and correctly leaves senderA pending.
    const senderA = createCustomBankTx({
      id: 501,
      created: Util.hoursBefore(48),
      valueDate: Util.hoursBefore(48),
      instructedAmount: 20100,
      instructedCurrency: 'EUR',
      remittanceInfo: 'manual sender A',
    });
    const senderB = createCustomBankTx({
      id: 502,
      created: Util.hoursBefore(24),
      valueDate: Util.hoursBefore(24),
      instructedAmount: 20000,
      instructedCurrency: 'EUR',
      remittanceInfo: 'manual sender B',
    });
    const receiverTx = [
      createCustomExchangeTx({
        id: 601,
        created: Util.hoursBefore(36),
        amount: 20000,
        currency: 'EUR',
        txId: undefined,
      }),
    ];

    // Final filter preserves unmatchedByRef order (= input sender order).
    expect(service.getUnmatchedSenders([senderA, senderB], receiverTx)).toEqual([senderA]);
    expect(service.getUnmatchedSenders([senderB, senderA], receiverTx)).toEqual([senderA]);
  });

  it('should retire both senders via augmenting path when greedy would strand one', () => {
    // Repro of the plain-greedy cardinality defect: edges in tolerance are
    // S1–R1 (diff 2), S2–R1 (diff 0), S2–R2 (diff 9); S1–R2 (diff 11) is OUT.
    // Greedy consumes S2–R1 first (lowest cost) and strands S1. Kuhn reassigns
    // S2→R2 so S1 can take R1 — maximum cardinality, both senders retired.
    const sender1 = createCustomBankTx({
      id: 701,
      created: Util.hoursBefore(48),
      valueDate: Util.hoursBefore(48),
      instructedAmount: 1000,
      instructedCurrency: 'EUR',
      remittanceInfo: 'cardinality sender 1',
    });
    const sender2 = createCustomBankTx({
      id: 702,
      created: Util.hoursBefore(24),
      valueDate: Util.hoursBefore(24),
      instructedAmount: 1002,
      instructedCurrency: 'EUR',
      remittanceInfo: 'cardinality sender 2',
    });
    const receiver1 = createCustomExchangeTx({
      id: 801,
      created: Util.hoursBefore(36),
      amount: 1002,
      currency: 'EUR',
      txId: undefined,
    });
    const receiver2 = createCustomExchangeTx({
      id: 802,
      created: Util.hoursBefore(12),
      amount: 1011,
      currency: 'EUR',
      txId: undefined,
    });

    expect(service.getUnmatchedSenders([sender1, sender2], [receiver1, receiver2])).toEqual([]);
    expect(service.getUnmatchedSenders([sender2, sender1], [receiver2, receiver1])).toEqual([]);
  });

  it('should not match and must not throw when a ref-less receiver or sender has a null amount', () => {
    // TypeORM nullable columns can surface as `null` at runtime even though the TS field type says
    // `number | undefined`. Both senders below must survive as unmatched, and the call must not throw.
    const senderWithAmount = createCustomBankTx({
      id: 303,
      created: Util.hoursBefore(24),
      valueDate: Util.hoursBefore(24),
      instructedAmount: 30000,
      instructedCurrency: 'EUR',
      remittanceInfo: 'sender with amount, null receiver',
    });
    const senderNullAmount = createCustomBankTx({
      id: 304,
      created: Util.hoursBefore(20),
      valueDate: Util.hoursBefore(20),
      instructedAmount: null as unknown as number,
      instructedCurrency: 'EUR',
      remittanceInfo: 'sender with null amount',
    });
    const receiverNullAmount = createCustomExchangeTx({
      id: 701,
      created: Util.hoursBefore(20),
      amount: null as unknown as number,
      currency: 'EUR',
      txId: undefined,
    });
    const receiverWithAmount = createCustomExchangeTx({
      id: 702,
      created: Util.hoursBefore(20),
      amount: 30000,
      currency: 'EUR',
      txId: undefined,
    });

    let result: (BankTx | ExchangeTx)[] = [];
    expect(() => {
      result = service.getUnmatchedSenders(
        [senderWithAmount, senderNullAmount],
        [receiverNullAmount, receiverWithAmount],
      );
    }).not.toThrow();

    // senderWithAmount would normally match receiverWithAmount (30000 == 30000), so the only way
    // it survives is if receiverNullAmount is correctly excluded as a candidate and doesn't
    // accidentally get treated as amount 0. senderNullAmount can never match anything.
    // Given both are in the array, senderWithAmount's real match (receiverWithAmount) is available,
    // so it WILL be retired -- only senderNullAmount remains unmatched.
    expect(result).toEqual([senderNullAmount]);
  });

  it('should retire an ExchangeTx withdrawal sender against a ref-less BankTx receiver by amount+date (fromScrypt direction), and reject an out-of-tolerance amount', () => {
    // Mirrors the existing toScrypt (bank -> exchange) pass-2 tests, but in the fromScrypt
    // direction (exchange withdrawal -> bank receipt), proving the generic fallback also collapses
    // the fromScrypt double-count. senderMatch's `created` is recent (survives the initial recency
    // filter) but its `externalCreated` is 9 days old -- if getTransferDate wrongly used `created`
    // instead of `externalCreated` for ExchangeTx, this match would incorrectly fall outside the
    // 7-day window and the test would fail, proving externalCreated is actually being used.
    const senderMatch = createCustomExchangeTx({
      id: 501,
      created: Util.hoursBefore(20),
      externalCreated: Util.hoursBefore(216),
      type: ExchangeTxType.WITHDRAWAL,
      amount: 20000,
      currency: 'CHF',
      txId: undefined,
    });
    const receiverMatch = createCustomBankTx({
      id: 601,
      created: Util.hoursBefore(216),
      valueDate: Util.hoursBefore(216),
      instructedAmount: 20000,
      instructedCurrency: 'CHF',
      remittanceInfo: undefined,
    });
    const senderNoMatch = createCustomExchangeTx({
      id: 502,
      created: Util.hoursBefore(20),
      externalCreated: Util.hoursBefore(40),
      type: ExchangeTxType.WITHDRAWAL,
      amount: 20000,
      currency: 'CHF',
      txId: undefined,
    });
    const receiverNoMatch = createCustomBankTx({
      id: 602,
      created: Util.hoursBefore(40),
      valueDate: Util.hoursBefore(40),
      instructedAmount: 25000,
      instructedCurrency: 'CHF',
      remittanceInfo: undefined,
    });

    const result = service.getUnmatchedSenders([senderMatch, senderNoMatch], [receiverMatch, receiverNoMatch]);

    expect(result).toEqual([senderNoMatch]);
  });

  // --- settlement-anchored buy_fiat liability (FinanceLog) ---

  // Yapeal CHF payout-bank asset: dexName = currency, bank = settling bank.
  // sellable=true keeps it active so it is not skipped by the asset-log reduce guard.
  const yapealChfAsset = (): Asset =>
    createCustomAsset({
      id: 5000,
      dexName: 'CHF',
      bank: yapealCHF,
      approxPriceChf: 1,
      refundEnabled: true,
      sellable: true,
    });

  // a transmitted-but-not-yet-settled Yapeal CHF sell payout
  const transmittedUnsettledBuyFiat = (transmittedAt: Date): BuyFiat =>
    createCustomBuyFiat({
      outputAmount: 9911.89,
      isComplete: false,
      sell: createCustomSell({ fiat: createCustomFiat({ name: 'CHF' }) }),
      fiatOutput: createCustomFiatOutput({
        bank: yapealCHF,
        isTransmittedDate: transmittedAt,
        outputDate: null,
      }),
    });

  // a transmitted-but-not-yet-settled Olky EUR sell payout — does NOT match a Yapeal CHF asset
  const transmittedUnsettledOlkyEur = (transmittedAt: Date): BuyFiat =>
    createCustomBuyFiat({
      outputAmount: 5000,
      isComplete: false,
      sell: createCustomSell({ fiat: createCustomFiat({ name: 'EUR' }) }),
      fiatOutput: createCustomFiatOutput({
        bank: olkyEUR,
        isTransmittedDate: transmittedAt,
        outputDate: null,
      }),
    });

  describe('settlement-anchored buy_fiat liability', () => {
    it('aggregates the transmitted-unsettled Yapeal liability into output (was 0 before the fix)', () => {
      const asset = yapealChfAsset();

      const { output } = service['getPendingAmounts']([asset], [transmittedUnsettledBuyFiat(new Date())]);

      expect(output).toEqual(9911.89);
    });

    // drive the full asset-log assembly (where the fail-closed guard lives) with a single bank asset
    function setupAssetLog(pendingBuyFiat: BuyFiat[]): Asset {
      const asset = yapealChfAsset();

      jest.spyOn(settingService, 'getCustomBalanceSettings').mockResolvedValue({ assets: [], addresses: [] });
      jest.spyOn(settingService, 'getObj').mockImplementation(async (_key, defaultValue) => defaultValue as never);
      jest.spyOn(paymentBalanceService, 'getPaymentBalances').mockResolvedValue(new Map());

      const bankFor = (name: IbanBankName, currency: string): Bank =>
        Object.assign(new Bank(), { name, currency, iban: `IBAN_${name}_${currency}`, bic: 'BICTEST' });
      jest.spyOn(bankService, 'getBankInternal').mockImplementation(async (name, currency) => bankFor(name, currency));

      jest.spyOn(liquidityManagementPipelineService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(payInService, 'getPendingPayIns').mockResolvedValue([]);
      jest.spyOn(buyFiatService, 'getPendingTransactions').mockResolvedValue(pendingBuyFiat);
      jest.spyOn(buyCryptoService, 'getPendingTransactions').mockResolvedValue([]);
      jest.spyOn(payoutService, 'getRecentPayoutSentCorrelationIds').mockResolvedValue(new Set());
      jest.spyOn(bankTxService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(bankTxRepeatService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(bankTxReturnService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(bankTxService, 'getRecentBankToBankTx').mockResolvedValue([]);
      jest.spyOn(bankTxService, 'getRecentExchangeTx').mockResolvedValue([]);
      jest.spyOn(exchangeTxService, 'getRecentExchangeTx').mockResolvedValue([]);

      return asset;
    }

    it('does NOT alarm when a transmitted-unsettled liability is correctly counted (fresh, within SLA)', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error');
      const asset = setupAssetLog([transmittedUnsettledBuyFiat(Util.hoursBefore(1))]);

      await service['getAssetLog']([asset]);

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('does NOT alarm on a non-matching payout and counts only the matching liability (per-asset scoping)', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error');
      // matching Yapeal CHF payout alongside a non-matching Olky EUR payout, both transmitted-unsettled
      const asset = setupAssetLog([
        transmittedUnsettledBuyFiat(Util.hoursBefore(1)),
        transmittedUnsettledOlkyEur(Util.hoursBefore(1)),
      ]);

      const assetLog = await service['getAssetLog']([asset]);

      // suppression tripwire must not fire — the Olky EUR liability is correctly scoped out, not "missing"
      expect(errorSpy).not.toHaveBeenCalled();
      // only the matching Yapeal CHF liability is counted in buyFiatPass (the Olky EUR 5000 is excluded)
      expect(assetLog[asset.id].minusBalance.pending.buyFiatPass).toEqual(9911.89);
    });

    it('alarms when the transmitted-unsettled liability is suppressed (pendingOutputAmount regressed to 0)', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error');
      const buyFiat = transmittedUnsettledBuyFiat(Util.hoursBefore(1));
      // simulate a re-introduced premature drop: pendingOutputAmount returns 0 while the independent guard still counts it
      jest.spyOn(buyFiat, 'pendingOutputAmount').mockReturnValue(0);
      const asset = setupAssetLog([buyFiat]);

      await service['getAssetLog']([asset]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('liability suppression'));
    });

    it('warns (not errors) when a transmitted payout is past the 144h settlement SLA', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error');
      const warnSpy = jest.spyOn(service['logger'], 'warn');
      const asset = setupAssetLog([transmittedUnsettledBuyFiat(Util.hoursBefore(150))]);

      await service['getAssetLog']([asset]);

      // ops-reconciliation signal: equity stays correct while a payout is stuck, so it warns rather than errors
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stale transmitted-unsettled'));
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('does NOT warn a transmitted payout still within the 144h settlement SLA (weekend+holiday gap)', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn');
      // ~111h (Fri evening -> Tue/Wed) is normal settlement and must not trip the SLA warning
      const asset = setupAssetLog([transmittedUnsettledBuyFiat(Util.hoursBefore(111))]);

      await service['getAssetLog']([asset]);

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('stale transmitted-unsettled'));
    });

    it('does NOT alarm a stale payout once it has settled (outputDate set)', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error');
      const settled = createCustomBuyFiat({
        outputAmount: 9911.89,
        isComplete: false,
        sell: createCustomSell({ fiat: createCustomFiat({ name: 'CHF' }) }),
        fiatOutput: createCustomFiatOutput({
          bank: yapealCHF,
          isTransmittedDate: Util.hoursBefore(80),
          outputDate: new Date(),
        }),
      });
      const asset = setupAssetLog([settled]);

      await service['getAssetLog']([asset]);

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('Frick EUR bank <-> Scrypt reconciliation (eurBankIbans completeness)', () => {
    beforeEach(() => {
      (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.clear();
      (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.set(
        `${IbanBankName.FRICK}-EUR`,
        frickEUR.iban,
      );
    });

    afterEach(() => {
      (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.clear();
    });

    it('captures a Frick EUR -> Scrypt bank_tx in the Scrypt/EUR pending aggregate (was silently dropped before eurBankIbans included Frick)', async () => {
      // sellable=true keeps both assets active so they are not skipped by the asset-log reduce guard
      const frickEurAsset = createCustomAsset({
        id: 7001,
        blockchain: Blockchain.FRICK,
        dexName: 'EUR',
        sellable: true,
      });
      const scryptEurAsset = createCustomAsset({
        id: 7002,
        blockchain: ExchangeName.SCRYPT as unknown as Blockchain,
        dexName: 'EUR',
        sellable: true,
      });
      const assets = [frickEurAsset, scryptEurAsset];

      jest.spyOn(settingService, 'getCustomBalanceSettings').mockResolvedValue({ assets: [], addresses: [] });
      jest.spyOn(settingService, 'getObj').mockImplementation(async (_key, defaultValue) => defaultValue as never);
      jest.spyOn(paymentBalanceService, 'getPaymentBalances').mockResolvedValue(new Map());

      const bankFor = (name: IbanBankName, currency: string): Bank =>
        name === IbanBankName.FRICK && currency === 'EUR'
          ? frickEUR
          : Object.assign(new Bank(), { name, currency, iban: `IBAN_${name}_${currency}`, bic: 'BICTEST' });
      jest.spyOn(bankService, 'getBankInternal').mockImplementation(async (name, currency) => bankFor(name, currency));

      jest.spyOn(liquidityManagementPipelineService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(payInService, 'getPendingPayIns').mockResolvedValue([]);
      jest.spyOn(buyFiatService, 'getPendingTransactions').mockResolvedValue([]);
      jest.spyOn(buyCryptoService, 'getPendingTransactions').mockResolvedValue([]);
      jest.spyOn(payoutService, 'getRecentPayoutSentCorrelationIds').mockResolvedValue(new Set());
      jest.spyOn(bankTxService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(bankTxRepeatService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(bankTxReturnService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(bankTxService, 'getRecentBankToBankTx').mockResolvedValue([]);

      // an unmatched (still-pending) debit from Frick's EUR IBAN into Scrypt
      const frickToScryptTx = createCustomBankTx({
        id: 90001,
        created: Util.hoursBefore(1),
        accountIban: frickEUR.iban,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        instructedCurrency: 'EUR',
        instructedAmount: 10000,
        amount: 10000,
        remittanceInfo: undefined,
      });
      jest
        .spyOn(bankTxService, 'getRecentExchangeTx')
        .mockImplementation(async (_minId, type) => (type === BankTxType.SCRYPT ? [frickToScryptTx] : []));
      jest.spyOn(exchangeTxService, 'getRecentExchangeTx').mockResolvedValue([]);

      const assetLog = await service['getAssetLog'](assets);

      // the Frick/EUR row itself stays zeroed (by design — aggregated under Scrypt/EUR instead),
      // so it has no pending plus-balance at all
      expect(assetLog[frickEurAsset.id].plusBalance.pending).toBeUndefined();

      // the Scrypt/EUR row now captures the Frick-sourced pending amount — before the fix this was 0
      // because eurBankIbans excluded Frick's IBAN, so the tx never entered recentEurBankToScryptTx
      expect(assetLog[scryptEurAsset.id].plusBalance.pending.toScrypt).toBe(10000);
    });
  });

  describe('Frick CHF bank <-> Scrypt reconciliation (chfBankIbans completeness)', () => {
    beforeEach(() => {
      (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.clear();
      (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.set(
        `${IbanBankName.YAPEAL}-CHF`,
        yapealCHF.iban,
      );
      (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.set(
        `${IbanBankName.FRICK}-CHF`,
        frickCHF.iban,
      );
    });

    afterEach(() => {
      (BankService as unknown as { ibanCache: Map<string, string> }).ibanCache.clear();
    });

    function setupChfScryptAssetLog(scryptBankTx: ReturnType<typeof createCustomBankTx>[]) {
      jest.spyOn(settingService, 'getCustomBalanceSettings').mockResolvedValue({ assets: [], addresses: [] });
      jest.spyOn(settingService, 'getObj').mockImplementation(async (_key, defaultValue) => defaultValue as never);
      jest.spyOn(paymentBalanceService, 'getPaymentBalances').mockResolvedValue(new Map());

      const bankFor = (name: IbanBankName, currency: string): Bank => {
        if (name === IbanBankName.YAPEAL && currency === 'CHF') return yapealCHF;
        if (name === IbanBankName.FRICK && currency === 'CHF') return frickCHF;
        return Object.assign(new Bank(), { name, currency, iban: `IBAN_${name}_${currency}`, bic: 'BICTEST' });
      };
      jest.spyOn(bankService, 'getBankInternal').mockImplementation(async (name, currency) => bankFor(name, currency));

      jest.spyOn(liquidityManagementPipelineService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(payInService, 'getPendingPayIns').mockResolvedValue([]);
      jest.spyOn(buyFiatService, 'getPendingTransactions').mockResolvedValue([]);
      jest.spyOn(buyCryptoService, 'getPendingTransactions').mockResolvedValue([]);
      jest.spyOn(payoutService, 'getRecentPayoutSentCorrelationIds').mockResolvedValue(new Set());
      jest.spyOn(bankTxService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(bankTxRepeatService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(bankTxReturnService, 'getPendingTx').mockResolvedValue([]);
      jest.spyOn(bankTxService, 'getRecentBankToBankTx').mockResolvedValue([]);
      jest
        .spyOn(bankTxService, 'getRecentExchangeTx')
        .mockImplementation(async (_minId, type) => (type === BankTxType.SCRYPT ? scryptBankTx : []));
      jest.spyOn(exchangeTxService, 'getRecentExchangeTx').mockResolvedValue([]);
    }

    // sellable=true keeps assets active so they are not skipped by the asset-log reduce guard
    const yapealChfCustodyAsset = (): Asset =>
      createCustomAsset({
        id: 8001,
        blockchain: Blockchain.YAPEAL,
        dexName: 'CHF',
        sellable: true,
      });
    const frickChfCustodyAsset = (): Asset =>
      createCustomAsset({
        id: 8002,
        blockchain: Blockchain.FRICK,
        dexName: 'CHF',
        sellable: true,
      });

    it('keeps Yapeal/CHF Bank->Scrypt pending bit-identical when there is no Frick CHF activity', async () => {
      const yapealAsset = yapealChfCustodyAsset();
      const frickAsset = frickChfCustodyAsset();

      // unmatched debit from Yapeal CHF only — same rows as before chfBankIbans generalization
      const yapealToScryptTx = createCustomBankTx({
        id: 91001,
        created: Util.hoursBefore(1),
        accountIban: yapealCHF.iban,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        instructedCurrency: 'CHF',
        instructedAmount: 5000,
        amount: 5000,
        remittanceInfo: undefined,
      });
      setupChfScryptAssetLog([yapealToScryptTx]);

      const assetLog = await service['getAssetLog']([yapealAsset, frickAsset]);

      // Yapeal/CHF still owns the pending Bank->Scrypt amount (accountIban fallback matches Yapeal only)
      expect(assetLog[yapealAsset.id].plusBalance.pending.toScrypt).toBe(5000);
      // Frick/CHF has no matching BankTx — must stay at zero / undefined pending
      expect(assetLog[frickAsset.id].plusBalance.pending?.toScrypt ?? 0).toBe(0);
    });

    it('attributes Frick CHF -> Scrypt bank_tx to Frick/CHF and not to Yapeal/CHF (no double-count)', async () => {
      const yapealAsset = yapealChfCustodyAsset();
      const frickAsset = frickChfCustodyAsset();

      // unmatched debit from Frick's CHF IBAN into Scrypt
      const frickToScryptTx = createCustomBankTx({
        id: 91002,
        created: Util.hoursBefore(1),
        accountIban: frickCHF.iban,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        instructedCurrency: 'CHF',
        instructedAmount: 7500,
        amount: 7500,
        remittanceInfo: undefined,
      });
      setupChfScryptAssetLog([frickToScryptTx]);

      const assetLog = await service['getAssetLog']([yapealAsset, frickAsset]);

      // Frick/CHF custody asset receives the pending Bank->Scrypt amount via accountIban fallback
      expect(assetLog[frickAsset.id].plusBalance.pending.toScrypt).toBe(7500);
      // Yapeal/CHF must not pick up the Frick debit (no double-count; baseline stays empty)
      expect(assetLog[yapealAsset.id].plusBalance.pending?.toScrypt ?? 0).toBe(0);
    });
  });
});
