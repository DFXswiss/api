import { createMock } from '@golevelup/ts-jest';
import { Exchange, Market } from 'ccxt';
import { QueueHandler } from 'src/shared/utils/queue-handler';
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
      jest.spyOn(exchange, 'fetchMarkets').mockResolvedValue([
        { symbol: 'BTC/EUR', active: true },
        { symbol: 'BTC/CHF', active: true },
        { symbol: 'ETH/EUR', active: true },
      ] as Market[]);
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
});
