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
import { OrderFailedException } from '../../../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../../../exceptions/order-not-processable.exception';
import { LiquidityManagementOrderRepository } from '../../../../repositories/liquidity-management-order.repository';
import { CcxtExchangeAdapter, CcxtExchangeAdapterCommands } from '../ccxt-exchange.adapter';

const DEST_ENV = 'TEST_MEXC_WITHDRAW_ADDR';
const DEST_ADDRESS = '4Aabc';
const WITHDRAW_KEY = 'mexcXmr';
const NETWORK = 'XMR';

/** The adapter is abstract only to force a venue to be named — every command is implemented on the base. */
class TestCcxtExchangeAdapter extends CcxtExchangeAdapter {}

function createOrder(
  command: CcxtExchangeAdapterCommands,
  minAmount: number,
  maxAmount: number,
  params: Record<string, unknown>,
): LiquidityManagementOrder {
  return Object.assign(new LiquidityManagementOrder(), {
    id: 4711,
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
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(111.9);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue({ min: 0.01, max: 100 });

      const order = createWithdrawOrder(60.5, 110.5);

      await expect(adapter.executeOrder(order)).resolves.toBe('w-1');
      expect(exchangeService.getWithdrawalLimits).toHaveBeenCalledWith('XMR', NETWORK);
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 100, DEST_ADDRESS, 'key-1', NETWORK);
      expect(order.inputAmount).toBe(100);
    });

    it('should send the full request when the venue publishes no maximum', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(111.9);

      await expect(adapter.executeOrder(createWithdrawOrder(60.5, 110.5))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 110.5, DEST_ADDRESS, 'key-1', NETWORK);
    });

    it('should report the capped maximum so the follow-up purchase is sized to it', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(0.9);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue({ min: 0.01, max: 100 });

      await expect(adapter.executeOrder(createWithdrawOrder(60.5, 110.5))).rejects.toThrow(
        new OrderNotProcessableException(
          'MEXC: not enough balance for XMR (balance: 0.9, min. requested: 60.5, max. requested: 100)',
        ),
      );
      expect(exchangeService.withdrawFunds).not.toHaveBeenCalled();
    });

    it('should cap the minimum as well, so a need above the maximum still passes the balance check', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(100);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue({ min: 0.01, max: 100 });

      await expect(adapter.executeOrder(createWithdrawOrder(110.5, 110.5))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 100, DEST_ADDRESS, 'key-1', NETWORK);
    });

    it('should stay limited by the available balance', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(40);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue({ min: 0.01, max: 100 });

      await expect(adapter.executeOrder(createWithdrawOrder(20, 110.5))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 40, DEST_ADDRESS, 'key-1', NETWORK);
    });

    it('should fail when the published maximum is below the published minimum', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(111.9);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue({ min: 5, max: 1 });

      await expect(adapter.executeOrder(createWithdrawOrder(60.5, 110.5))).rejects.toThrow(OrderFailedException);
      expect(exchangeService.withdrawFunds).not.toHaveBeenCalled();
    });
  });

  describe('transfer', () => {
    it('should cap the request, target optimum included, at the published withdrawal maximum', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(150);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue({ min: 0.01, max: 100 });

      const order = createTransferOrder(10, 90, 30);

      await expect(adapter.executeOrder(order)).resolves.toBe('w-1');
      expect(exchangeService.getWithdrawalLimits).toHaveBeenCalledWith('XMR', NETWORK);
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 100, DEST_ADDRESS, 'key-1', NETWORK);
      expect(order.inputAmount).toBe(100);
    });

    it('should send the full request when the venue publishes no maximum', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(150);

      await expect(adapter.executeOrder(createTransferOrder(10, 90, 30))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 120, DEST_ADDRESS, 'key-1', NETWORK);
    });

    it('should cap the minimum as well, so a need above the maximum still passes the balance check', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(100);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue({ min: 0.01, max: 100 });

      await expect(adapter.executeOrder(createTransferOrder(110.5, 110.5))).resolves.toBe('w-1');
      expect(exchangeService.withdrawFunds).toHaveBeenCalledWith('XMR', 100, DEST_ADDRESS, 'key-1', NETWORK);
    });

    it('should fail when the published maximum is below the published minimum', async () => {
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(150);
      jest.spyOn(exchangeService, 'getWithdrawalLimits').mockResolvedValue({ min: 5, max: 1 });

      await expect(adapter.executeOrder(createTransferOrder(10, 90, 30))).rejects.toThrow(OrderFailedException);
      expect(exchangeService.withdrawFunds).not.toHaveBeenCalled();
    });
  });
});
