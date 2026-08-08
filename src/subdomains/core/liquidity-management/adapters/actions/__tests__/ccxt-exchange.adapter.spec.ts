import { createMock } from '@golevelup/ts-jest';
import { PairNotTradableException } from 'src/integration/exchange/exceptions/pair-not-tradable.exception';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { ExchangeService, OrderSide } from 'src/integration/exchange/services/exchange.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LiquidityManagementAction } from '../../../entities/liquidity-management-action.entity';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderNotProcessableException } from '../../../exceptions/order-not-processable.exception';
import { LiquidityManagementOrderRepository } from '../../../repositories/liquidity-management-order.repository';
import { CcxtExchangeAdapter } from '../base/ccxt-exchange.adapter';

/** Concrete test double — CcxtExchangeAdapter is abstract. */
class TestCcxtExchangeAdapter extends CcxtExchangeAdapter {
  constructor(
    exchangeService: ExchangeService,
    exchangeRegistry: ExchangeRegistryService,
    dexService: DexService,
    orderRepo: LiquidityManagementOrderRepository,
    pricingService: PricingService,
    assetService: AssetService,
  ) {
    super(
      LiquidityManagementSystem.BINANCE,
      exchangeService,
      exchangeRegistry,
      dexService,
      orderRepo,
      pricingService,
      assetService,
    );
  }
}

describe('CcxtExchangeAdapter', () => {
  let adapter: TestCcxtExchangeAdapter;
  let exchangeService: ExchangeService;
  let assetService: AssetService;
  let pricingService: PricingService;

  beforeEach(() => {
    exchangeService = createMock<ExchangeService>({ name: 'Binance' });
    assetService = createMock<AssetService>();
    pricingService = createMock<PricingService>();

    adapter = new TestCcxtExchangeAdapter(
      exchangeService,
      createMock<ExchangeRegistryService>(),
      createMock<DexService>(),
      createMock<LiquidityManagementOrderRepository>(),
      pricingService,
      assetService,
    );
  });

  function buyOrder(): LiquidityManagementOrder {
    const targetAsset = Object.assign(new Asset(), { name: 'POL', dexName: 'POL' });
    return Object.assign(new LiquidityManagementOrder(), {
      minAmount: 1,
      maxAmount: 10,
      action: Object.assign(new LiquidityManagementAction(), {
        command: 'buy',
        params: JSON.stringify({ tradeAsset: 'BTC' }),
      }),
      pipeline: { rule: { targetAsset } },
    });
  }

  function sellOrder(): LiquidityManagementOrder {
    const targetAsset = Object.assign(new Asset(), { name: 'POL', dexName: 'POL' });
    return Object.assign(new LiquidityManagementOrder(), {
      minAmount: 1,
      maxAmount: 10,
      action: Object.assign(new LiquidityManagementAction(), {
        command: 'sell',
        params: JSON.stringify({ tradeAsset: 'BTC' }),
      }),
      pipeline: { rule: { targetAsset } },
    });
  }

  describe('buy', () => {
    it('translates PairNotTradableException from getAndCheckTradePrice into OrderNotProcessableException', async () => {
      const order = buyOrder();
      const tradeAsset = Object.assign(new Asset(), { name: 'BTC' });

      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(0);
      jest.spyOn(assetService, 'getAssetByUniqueName').mockResolvedValue(tradeAsset);
      jest
        .spyOn(exchangeService, 'getCurrentPrice')
        .mockRejectedValue(new PairNotTradableException('Binance: no asks in order book for POL/BTC (buy)'));

      await expect(adapter['buy'](order)).rejects.toBeInstanceOf(OrderNotProcessableException);
      await expect(adapter['buy'](order)).rejects.toThrow(/no asks in order book for POL\/BTC/);
    });

    it('translates PairNotTradableException from exchangeService.sell into OrderNotProcessableException', async () => {
      const order = buyOrder();
      const tradeAsset = Object.assign(new Asset(), { name: 'BTC' });

      jest.spyOn(exchangeService, 'getAvailableBalance').mockImplementation(async (currency: string) => {
        if (currency === 'BTC') return 1000;
        return 0;
      });
      jest.spyOn(assetService, 'getAssetByUniqueName').mockResolvedValue(tradeAsset);
      jest.spyOn(exchangeService, 'getCurrentPrice').mockResolvedValue(1);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue(Object.assign(new Price(), { price: 1 }));
      jest.spyOn(exchangeService, 'getTradePair').mockResolvedValue({ pair: 'POL/BTC', direction: OrderSide.SELL });
      jest
        .spyOn(exchangeService, 'sell')
        .mockRejectedValue(new PairNotTradableException('Binance: market POL/BTC is not active'));

      await expect(adapter['buy'](order)).rejects.toBeInstanceOf(OrderNotProcessableException);
      await expect(adapter['buy'](order)).rejects.toThrow(/market POL\/BTC is not active/);
    });
  });

  describe('sell', () => {
    it('translates PairNotTradableException from getAndCheckTradePrice into OrderNotProcessableException', async () => {
      const order = sellOrder();
      const tradeAsset = Object.assign(new Asset(), { name: 'BTC' });

      jest.spyOn(assetService, 'getAssetByUniqueName').mockResolvedValue(tradeAsset);
      jest
        .spyOn(exchangeService, 'getCurrentPrice')
        .mockRejectedValue(new PairNotTradableException('Binance: market POL/BTC is not active'));

      await expect(adapter['sell'](order)).rejects.toBeInstanceOf(OrderNotProcessableException);
      await expect(adapter['sell'](order)).rejects.toThrow(/market POL\/BTC is not active/);
    });

    it('translates PairNotTradableException from exchangeService.sell into OrderNotProcessableException', async () => {
      const order = sellOrder();
      const tradeAsset = Object.assign(new Asset(), { name: 'BTC' });

      jest.spyOn(assetService, 'getAssetByUniqueName').mockResolvedValue(tradeAsset);
      jest.spyOn(exchangeService, 'getCurrentPrice').mockResolvedValue(1);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue(Object.assign(new Price(), { price: 1 }));
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(1000);
      jest.spyOn(exchangeService, 'getTradePair').mockResolvedValue({ pair: 'POL/BTC', direction: OrderSide.SELL });
      jest
        .spyOn(exchangeService, 'sell')
        .mockRejectedValue(new PairNotTradableException('Binance: no bids in order book for POL/BTC (sell)'));

      await expect(adapter['sell'](order)).rejects.toBeInstanceOf(OrderNotProcessableException);
      await expect(adapter['sell'](order)).rejects.toThrow(/no bids in order book for POL\/BTC/);
    });

    it('translates PairNotTradableException from getAvailableTradeBalance into OrderNotProcessableException', async () => {
      const order = sellOrder();
      const tradeAsset = Object.assign(new Asset(), { name: 'BTC' });

      jest.spyOn(assetService, 'getAssetByUniqueName').mockResolvedValue(tradeAsset);
      jest.spyOn(exchangeService, 'getCurrentPrice').mockResolvedValue(1);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue(Object.assign(new Price(), { price: 1 }));
      jest.spyOn(exchangeService, 'getAvailableBalance').mockResolvedValue(1000);
      jest
        .spyOn(exchangeService, 'getTradePair')
        .mockRejectedValue(new PairNotTradableException('Binance: market POL/BTC is not active'));

      await expect(adapter['sell'](order)).rejects.toBeInstanceOf(OrderNotProcessableException);
      await expect(adapter['sell'](order)).rejects.toThrow(/market POL\/BTC is not active/);
    });
  });
});
