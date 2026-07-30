import { createMock } from '@golevelup/ts-jest';
import { CronExpression } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Process } from 'src/shared/services/process.service';
import { DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { TestUtil } from 'src/shared/utils/test.util';
import { BankTxConsumer } from '../consumers/bank-tx.consumer';
import { BuyCryptoConsumer } from '../consumers/buy-crypto.consumer';
import { BuyFiatConsumer } from '../consumers/buy-fiat.consumer';
import { CryptoInputConsumer } from '../consumers/crypto-input.consumer';
import { ExchangeTxConsumer } from '../consumers/exchange-tx.consumer';
import { LiquidityMgmtConsumer } from '../consumers/liquidity-mgmt.consumer';
import { LiquidityOrderDexConsumer } from '../consumers/liquidity-order-dex.consumer';
import { PayoutOrderConsumer } from '../consumers/payout-order.consumer';
import { TradingOrderConsumer } from '../consumers/trading-order.consumer';
import { getLedgerWatermark, LedgerBookingJobService, setLedgerWatermark } from '../ledger-booking-job.service';
import { LedgerBootstrapService } from '../ledger-bootstrap.service';

describe('LedgerBookingJobService', () => {
  let service: LedgerBookingJobService;
  let settingService: SettingService;
  let bankTxConsumer: BankTxConsumer;
  let exchangeTxConsumer: ExchangeTxConsumer;
  let cryptoInputConsumer: CryptoInputConsumer;
  let payoutOrderConsumer: PayoutOrderConsumer;
  let buyCryptoConsumer: BuyCryptoConsumer;
  let buyFiatConsumer: BuyFiatConsumer;
  let liquidityMgmtConsumer: LiquidityMgmtConsumer;
  let liquidityOrderDexConsumer: LiquidityOrderDexConsumer;
  let tradingOrderConsumer: TradingOrderConsumer;
  let bootstrapService: LedgerBootstrapService;

  beforeEach(async () => {
    settingService = createMock<SettingService>();
    bankTxConsumer = createMock<BankTxConsumer>();
    exchangeTxConsumer = createMock<ExchangeTxConsumer>();
    cryptoInputConsumer = createMock<CryptoInputConsumer>();
    payoutOrderConsumer = createMock<PayoutOrderConsumer>();
    buyCryptoConsumer = createMock<BuyCryptoConsumer>();
    buyFiatConsumer = createMock<BuyFiatConsumer>();
    liquidityMgmtConsumer = createMock<LiquidityMgmtConsumer>();
    liquidityOrderDexConsumer = createMock<LiquidityOrderDexConsumer>();
    tradingOrderConsumer = createMock<TradingOrderConsumer>();
    bootstrapService = createMock<LedgerBootstrapService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerBookingJobService,
        TestUtil.provideConfig(),
        { provide: SettingService, useValue: settingService },
        { provide: BankTxConsumer, useValue: bankTxConsumer },
        { provide: ExchangeTxConsumer, useValue: exchangeTxConsumer },
        { provide: CryptoInputConsumer, useValue: cryptoInputConsumer },
        { provide: PayoutOrderConsumer, useValue: payoutOrderConsumer },
        { provide: BuyCryptoConsumer, useValue: buyCryptoConsumer },
        { provide: BuyFiatConsumer, useValue: buyFiatConsumer },
        { provide: LiquidityMgmtConsumer, useValue: liquidityMgmtConsumer },
        { provide: LiquidityOrderDexConsumer, useValue: liquidityOrderDexConsumer },
        { provide: TradingOrderConsumer, useValue: tradingOrderConsumer },
        { provide: LedgerBootstrapService, useValue: bootstrapService },
      ],
    }).compile();

    service = module.get<LedgerBookingJobService>(LedgerBookingJobService);
    // Existing cutover-gate tests exercise behaviour with the master switch on (default is hard OFF).
    Config.ledger.enabled = true;
  });

  afterEach(() => {
    Config.ledger.enabled = false;
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('isLedgerReady (cutover gate, Blocker R1-6)', () => {
    it('is false until ledgerCutoverLogId is set', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      expect(await service.isLedgerReady()).toBe(false);
    });

    it('is true once ledgerCutoverLogId is set', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue('1557344');
      expect(await service.isLedgerReady()).toBe(true);
    });

    it('is false when Config.ledger.enabled is false — short-circuits before settingService.get', async () => {
      Config.ledger.enabled = false;
      const getSpy = jest.spyOn(settingService, 'get').mockResolvedValue('1557344');

      expect(await service.isLedgerReady()).toBe(false);
      expect(getSpy).not.toHaveBeenCalled();
    });

    it('with Config.ledger.enabled true and cutover set, is true (no regression on enabled path)', async () => {
      Config.ledger.enabled = true;
      jest.spyOn(settingService, 'get').mockResolvedValue('1557344');

      expect(await service.isLedgerReady()).toBe(true);
      expect(settingService.get).toHaveBeenCalled();
    });
  });

  describe('cron wrappers gate on isLedgerReady (no-op until cutover)', () => {
    it('does not run a consumer while the ledger is not ready', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
      await service.runBankTx();
      await service.runExchangeTx();
      await service.runCryptoInput();
      await service.runPayoutOrder();
      await service.runBuyCrypto();
      await service.runBuyFiat();
      await service.runLiquidityMgmt();
      await service.runLiquidityOrderDex();
      await service.runTradingOrder();
      await service.runCoaBootstrap();
      expect(bankTxConsumer.process).not.toHaveBeenCalled();
      expect(exchangeTxConsumer.process).not.toHaveBeenCalled();
      expect(cryptoInputConsumer.process).not.toHaveBeenCalled();
      expect(payoutOrderConsumer.process).not.toHaveBeenCalled();
      expect(buyCryptoConsumer.process).not.toHaveBeenCalled();
      expect(buyFiatConsumer.process).not.toHaveBeenCalled();
      expect(liquidityMgmtConsumer.process).not.toHaveBeenCalled();
      expect(liquidityOrderDexConsumer.process).not.toHaveBeenCalled();
      expect(tradingOrderConsumer.process).not.toHaveBeenCalled();
      expect(bootstrapService.bootstrap).not.toHaveBeenCalled();
    });

    it('runs the consumers once the ledger is ready', async () => {
      jest.spyOn(settingService, 'get').mockResolvedValue('1');
      await service.runBankTx();
      await service.runExchangeTx();
      await service.runCryptoInput();
      await service.runPayoutOrder();
      await service.runBuyCrypto();
      await service.runBuyFiat();
      await service.runLiquidityMgmt();
      await service.runLiquidityOrderDex();
      await service.runTradingOrder();
      await service.runCoaBootstrap();
      expect(bankTxConsumer.process).toHaveBeenCalledTimes(1);
      expect(exchangeTxConsumer.process).toHaveBeenCalledTimes(1);
      expect(cryptoInputConsumer.process).toHaveBeenCalledTimes(1);
      expect(payoutOrderConsumer.process).toHaveBeenCalledTimes(1);
      expect(buyCryptoConsumer.process).toHaveBeenCalledTimes(1);
      expect(buyFiatConsumer.process).toHaveBeenCalledTimes(1);
      expect(liquidityMgmtConsumer.process).toHaveBeenCalledTimes(1);
      expect(liquidityOrderDexConsumer.process).toHaveBeenCalledTimes(1);
      expect(tradingOrderConsumer.process).toHaveBeenCalledTimes(1);
      expect(bootstrapService.bootstrap).toHaveBeenCalledTimes(1);
    });
  });

  describe('@DfxCron kill-switch + schedule (Hard Constraint #5, Minor R9-2)', () => {
    // every registered cron method must carry a Process flag (no silent no-guard cron) AND its intended schedule:
    // the nine booking wrappers run EVERY_MINUTE, only the CoA bootstrap runs EVERY_5_MINUTES
    const expectedCrons: Record<string, { process: Process; expression: CronExpression }> = {
      runBankTx: { process: Process.LEDGER_BOOKING_BANK_TX, expression: CronExpression.EVERY_MINUTE },
      runExchangeTx: { process: Process.LEDGER_BOOKING_EXCHANGE_TX, expression: CronExpression.EVERY_MINUTE },
      runCryptoInput: { process: Process.LEDGER_BOOKING_CRYPTO_INPUT, expression: CronExpression.EVERY_MINUTE },
      runPayoutOrder: { process: Process.LEDGER_BOOKING_PAYOUT, expression: CronExpression.EVERY_MINUTE },
      runBuyCrypto: { process: Process.LEDGER_BOOKING_BUY_CRYPTO, expression: CronExpression.EVERY_MINUTE },
      runBuyFiat: { process: Process.LEDGER_BOOKING_BUY_FIAT, expression: CronExpression.EVERY_MINUTE },
      runLiquidityMgmt: {
        process: Process.LEDGER_BOOKING_LIQUIDITY_MANAGEMENT,
        expression: CronExpression.EVERY_MINUTE,
      },
      runLiquidityOrderDex: {
        process: Process.LEDGER_BOOKING_LIQUIDITY_ORDER,
        expression: CronExpression.EVERY_MINUTE,
      },
      runTradingOrder: { process: Process.LEDGER_BOOKING_TRADING_ORDER, expression: CronExpression.EVERY_MINUTE },
      runCoaBootstrap: { process: Process.LEDGER_COA_BOOTSTRAP, expression: CronExpression.EVERY_5_MINUTES },
    };

    for (const [method, expected] of Object.entries(expectedCrons)) {
      it(`${method} carries its own ${expected.process} process flag, its schedule and the lock timeout`, () => {
        const params: DfxCronParams = Reflect.getMetadata(
          DFX_CRONJOB_PARAMS,
          LedgerBookingJobService.prototype[method as keyof LedgerBookingJobService],
        );
        expect(params).toBeDefined();
        expect(params.process).toBe(expected.process);
        expect(params.expression).toBe(expected.expression);
        expect(params.timeout).toBe(1800);
      });
    }
  });

  describe('watermark helpers (§11.3, set via settingService.set as JSON)', () => {
    it('reads a watermark via getObj and parses lastReversalScan to a Date', async () => {
      jest.spyOn(settingService, 'getObj').mockResolvedValue({
        lastProcessedId: 42,
        lastReversalScan: '2026-06-01T00:00:00.000Z',
        lastReversalScanId: 9,
      } as any);
      const wm = await getLedgerWatermark(settingService, 'bank_tx');
      expect(wm.lastProcessedId).toBe(42);
      expect(wm.lastReversalScan).toBeInstanceOf(Date);
      expect(wm.lastReversalScan.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(wm.lastReversalScanId).toBe(9); // combined (updated, id) cursor id-tiebreak (§4.12)
    });

    it('defaults lastReversalScanId to 0 for a legacy watermark without the field', async () => {
      jest
        .spyOn(settingService, 'getObj')
        .mockResolvedValue({ lastProcessedId: 42, lastReversalScan: '2026-06-01T00:00:00.000Z' } as any);
      const wm = await getLedgerWatermark(settingService, 'bank_tx');
      expect(wm.lastReversalScanId).toBe(0); // backward-compatible read of a pre-cursor watermark
    });

    it('returns undefined when no watermark exists yet', async () => {
      jest.spyOn(settingService, 'getObj').mockResolvedValue(undefined);
      expect(await getLedgerWatermark(settingService, 'bank_tx')).toBeUndefined();
    });

    it('writes a watermark exclusively via settingService.set (never setObj/settingRepo, §4.10 R2-exception-a)', async () => {
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
      await setLedgerWatermark(settingService, 'crypto_input', {
        lastProcessedId: 7,
        lastReversalScan: new Date('2026-06-02T00:00:00.000Z'),
        lastReversalScanId: 3,
      });
      expect(setSpy).toHaveBeenCalledWith(
        'ledgerWatermark.crypto_input',
        JSON.stringify({ lastProcessedId: 7, lastReversalScan: '2026-06-02T00:00:00.000Z', lastReversalScanId: 3 }),
      );
    });

    it('serializes lastReversalScanId as 0 when omitted (combined-cursor default)', async () => {
      const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
      await setLedgerWatermark(settingService, 'crypto_input', {
        lastProcessedId: 7,
        lastReversalScan: new Date('2026-06-02T00:00:00.000Z'),
      });
      expect(setSpy).toHaveBeenCalledWith(
        'ledgerWatermark.crypto_input',
        JSON.stringify({ lastProcessedId: 7, lastReversalScan: '2026-06-02T00:00:00.000Z', lastReversalScanId: 0 }),
      );
    });
  });
});
