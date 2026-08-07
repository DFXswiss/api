import { createMock } from '@golevelup/ts-jest';
import { WithdrawalResponse } from 'ccxt';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { ExchangeService } from 'src/integration/exchange/services/exchange.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LiquidityManagementAction } from '../../../../entities/liquidity-management-action.entity';
import { LiquidityManagementOrder } from '../../../../entities/liquidity-management-order.entity';
import { LiquidityManagementPipeline } from '../../../../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementRule } from '../../../../entities/liquidity-management-rule.entity';
import { LiquidityManagementSystem } from '../../../../enums';
import { OrderNotProcessableException } from '../../../../exceptions/order-not-processable.exception';
import { LiquidityManagementOrderRepository } from '../../../../repositories/liquidity-management-order.repository';
import { CcxtExchangeAdapter, CcxtExchangeAdapterCommands } from '../ccxt-exchange.adapter';

const DEST_ENV = 'TEST_EXCHANGE_WITHDRAW_ADDR';
const DEST_ADDRESS = 'test-destination-address';
const WITHDRAW_KEY = 'testWithdrawKey';
const NETWORK = 'XMR';

// neutral round numbers throughout: every assertion is about the capping arithmetic, never about an amount
const venueLimits = { min: 0.5, max: 50 };

// a maximum below the last decimal the adapter keeps - applied, it floors the withdrawal to zero
const subPrecisionLimits = { min: 0.0000001, max: 0.0000001 };

/** The adapter is abstract only to force a venue to be named — every command is implemented on the base. */
class TestCcxtExchangeAdapter extends CcxtExchangeAdapter {}

function createOrder(
  command: CcxtExchangeAdapterCommands,
  minAmount: number,
  maxAmount: number,
  params: Record<string, unknown>,
): LiquidityManagementOrder {
  return Object.assign(new LiquidityManagementOrder(), {
    id: 1,
    minAmount,
    maxAmount,
    // `paramMap` is a getter over `params`, so a fixture sets the raw field
    action: Object.assign(new LiquidityManagementAction(), { command, params: JSON.stringify(params) }),
    pipeline: Object.assign(new LiquidityManagementPipeline(), {
      rule: Object.assign(new LiquidityManagementRule(), {
        targetAsset: Object.assign(new Asset(), { id: 1, dexName: 'XMR', uniqueName: 'MEXC/XMR' }),
      }),
    }),
  });
}

function createWithdrawOrder(minAmount: number, maxAmount: number): LiquidityManagementOrder {
  return createOrder(CcxtExchangeAdapterCommands.WITHDRAW, minAmount, maxAmount, {
    destinationAddress: DEST_ENV,
    destinationAddressKey: WITHDRAW_KEY,
    destinationBlockchain: Blockchain.MONERO,
  });
}

function createTransferOrder(minAmount: number, maxAmount: number, optimum?: number): LiquidityManagementOrder {
  return createOrder(CcxtExchangeAdapterCommands.TRANSFER, minAmount, maxAmount, {
    destinationAddress: DEST_ENV,
    destinationAddressKey: WITHDRAW_KEY,
    destinationBlockchain: Blockchain.MONERO,
    targetExchange: 'Binance',
    targetOptimum: optimum,
  });
}

describe('CcxtExchangeAdapter', () => {
  let adapter: TestCcxtExchangeAdapter;
  let exchangeService: ExchangeService;

  beforeEach(() => {
    process.env[DEST_ENV] = DEST_ADDRESS;

    exchangeService = createMock<ExchangeService>({ name: 'MEXC' });
    Object.assign(exchangeService, { config: { withdrawKeys: new Map([[WITHDRAW_KEY, 'key-1']]) } });

    jest.spyOn(exchangeService, 'mapNetwork').mockReturnValue(NETWORK);
    jest.spyOn(exchangeService, 'withdrawFunds').mockResolvedValue({ id: 'w-1' } as WithdrawalResponse);
    // default: the venue publishes nothing, which must leave the request untouched
    jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue({});

    adapter = new TestCcxtExchangeAdapter(
      LiquidityManagementSystem.MEXC,
      exchangeService,
      createMock<ExchangeRegistryService>(),
      createMock<DexService>(),
      createMock<LiquidityManagementOrderRepository>(),
      createMock<PricingService>(),
      createMock<AssetService>(),
    );
  });

  afterEach(() => {
    delete process.env[DEST_ENV];
    jest.restoreAllMocks();
  });

  describe('withdraw', () => {
    it('should cap the request at the published withdrawal maximum', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(90);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue(venueLimits);

      const order = createWithdrawOrder(30, 80);

      await expect(adapter.executeOrder(order)).resolves.toBe('w-1');
      expect(exchangeService.getWithdrawalLimits).toHaveBeenCalledWith('XMR', NETWORK);
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 50, DEST_ADDRESS, 'key-1', NETWORK);
      expect(order.inputAmount).toBe(50);
    });

    it('should send the full request when the venue publishes no maximum', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(90);

      await expect(adapter.executeOrder(createWithdrawOrder(30, 80))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 80, DEST_ADDRESS, 'key-1', NETWORK);
    });

    it('should report the capped maximum so the follow-up purchase is sized to it', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(10);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue(venueLimits);

      await expect(adapter.executeOrder(createWithdrawOrder(30, 80))).rejects.toThrow(
        new OrderNotProcessableException(
          'MEXC: not enough balance for XMR (balance: 10, min. requested: 30, max. requested: 50)',
        ),
      );
      expect(exchangeService.withdrawFunds).not.toHaveBeenCalled();
    });

    it('should cap the minimum as well, so a need above the maximum still passes the balance check', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(50);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue(venueLimits);

      await expect(adapter.executeOrder(createWithdrawOrder(80, 80))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 50, DEST_ADDRESS, 'key-1', NETWORK);
    });

    it('should stay limited by the available balance', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(20);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue(venueLimits);

      await expect(adapter.executeOrder(createWithdrawOrder(10, 80))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 20, DEST_ADDRESS, 'key-1', NETWORK);
    });

    it('should log the capped request, the only place the short delivery becomes visible', async () => {
      const info = jest.spyOn(adapter['logger'], 'info').mockImplementation(() => undefined);

      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(90);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue(venueLimits);

      await adapter.executeOrder(createWithdrawOrder(30, 80));

      expect(info).toHaveBeenCalledWith(expect.stringContaining('capping the XMR withdrawal request of 80'));
    });

    it('should not log a cap when the request is below the published maximum', async () => {
      const info = jest.spyOn(adapter['logger'], 'info').mockImplementation(() => undefined);

      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(90);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue(venueLimits);

      await adapter.executeOrder(createWithdrawOrder(10, 20));

      expect(info).not.toHaveBeenCalled();
    });

    // a contradictory pair of published limits is the venue's problem, not a reason to kill the pipeline:
    // the request is capped and sent, and the venue answers whether it accepts it
    it('should warn and still send when the published maximum is below the published minimum', async () => {
      const warn = jest.spyOn(adapter['logger'], 'warn').mockImplementation(() => undefined);

      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(90);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue({ min: 5, max: 1 });

      await expect(adapter.executeOrder(createWithdrawOrder(0.5, 80))).resolves.toBe('w-1');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('below the published minimum'));
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 1, DEST_ADDRESS, 'key-1', NETWORK);
    });

    // capping to zero is the one outcome the limits are read to prevent: it turns a working payout into an
    // endless loop of empty deliveries, so a maximum that cannot survive the flooring counts as unknown
    it('should leave the request uncapped when the published maximum floors to zero', async () => {
      const warn = jest.spyOn(adapter['logger'], 'warn').mockImplementation(() => undefined);

      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(90);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue(subPrecisionLimits);

      await expect(adapter.executeOrder(createWithdrawOrder(30, 80))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 80, DEST_ADDRESS, 'key-1', NETWORK);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('below the withdrawal precision'));
    });
  });

  describe('transfer', () => {
    it('should cap the request, target optimum included, at the published withdrawal maximum', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(90);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue(venueLimits);

      const order = createTransferOrder(10, 60, 20);

      await expect(adapter.executeOrder(order)).resolves.toBe('w-1');
      expect(exchangeService.getWithdrawalLimits).toHaveBeenCalledWith('XMR', NETWORK);
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 50, DEST_ADDRESS, 'key-1', NETWORK);
      expect(order.inputAmount).toBe(50);
    });

    it('should send the full request when the venue publishes no maximum', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(90);

      await expect(adapter.executeOrder(createTransferOrder(10, 60, 20))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 80, DEST_ADDRESS, 'key-1', NETWORK);
    });

    it('should cap the minimum as well, so a need above the maximum still passes the balance check', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(50);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue(venueLimits);

      await expect(adapter.executeOrder(createTransferOrder(80, 80))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 50, DEST_ADDRESS, 'key-1', NETWORK);
    });

    it('should warn and still send when the published maximum is below the published minimum', async () => {
      const warn = jest.spyOn(adapter['logger'], 'warn').mockImplementation(() => undefined);

      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(90);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue({ min: 5, max: 1 });

      await expect(adapter.executeOrder(createTransferOrder(0.5, 60, 20))).resolves.toBe('w-1');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('below the published minimum'));
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 1, DEST_ADDRESS, 'key-1', NETWORK);
    });

    it('should leave the request uncapped when the published maximum floors to zero', async () => {
      jest.spyOn(adapter['logger'], 'warn').mockImplementation(() => undefined);

      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(90);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue(subPrecisionLimits);

      await expect(adapter.executeOrder(createTransferOrder(10, 60, 20))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 80, DEST_ADDRESS, 'key-1', NETWORK);
    });
  });
});
