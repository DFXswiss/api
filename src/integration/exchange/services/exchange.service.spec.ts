import { createMock } from '@golevelup/ts-jest';
import { Exchange, Market } from 'ccxt';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { PartialTradeResponse } from '../dto/trade-response.dto';
import { ExchangeService, OrderSide } from './exchange.service';

describe('ExchangeService', () => {
  let service: ExchangeService;

  let exchange: Exchange;

  beforeEach(() => {
    exchange = createMock<Exchange>();

    service = new ExchangeService(exchange, new QueueHandler(undefined, undefined));
  });

  afterEach(() => {
    service['queue'].stop();
  });

  const Setup = {
    Markets: () => {
      jest
        .spyOn(exchange, 'fetchMarkets')
        .mockResolvedValue([{ symbol: 'BTC/EUR' }, { symbol: 'BTC/CHF' }, { symbol: 'ETH/EUR' }] as Market[]);
    },
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return BTC/EUR and buy', async () => {
    Setup.Markets();

    await expect(service.getTradePair('EUR', 'BTC')).resolves.toEqual({ pair: 'BTC/EUR', direction: OrderSide.BUY });
  });

  it('should return BTC/EUR and sell', async () => {
    Setup.Markets();

    await expect(service.getTradePair('BTC', 'EUR')).resolves.toEqual({
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
