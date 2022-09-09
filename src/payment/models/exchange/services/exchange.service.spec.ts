import { kraken } from 'ccxt';
import { PartialTradeResponse } from '../dto/trade-response.dto';
import { ExchangeService, OrderSide } from './exchange.service';

describe('ExchangeService', () => {
  let service: ExchangeService;

  beforeEach(async () => {
    service = new ExchangeService(new kraken({}));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return BTC/EUR and buy', async () => {
    await expect(service.getCurrencyPair('EUR', 'BTC')).resolves.toEqual({ pair: 'BTC/EUR', direction: OrderSide.BUY });
  });

  it('should return BTC/EUR and sell', async () => {
    await expect(service.getCurrencyPair('BTC', 'EUR')).resolves.toEqual({
      pair: 'BTC/EUR',
      direction: OrderSide.SELL,
    });
  });

  it('should return correct weighted average', () => {
    const list = [
      { price: 0.1, toAmount: 3.8, fee: { cost: 2.3 } },
      { price: 1.2, toAmount: 1.4, fee: { cost: 1.4 } },
    ] as PartialTradeResponse[];
    expect(service.getWeightedAveragePrice(list)).toEqual({ price: 0.39615385, amountSum: 5.2, feeSum: 3.7 });
  });
});
