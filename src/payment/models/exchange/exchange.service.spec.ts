import { Test, TestingModule } from '@nestjs/testing';
import { kraken } from 'ccxt';
import { ExchangeService, OrderSide } from './exchange.service';

describe('ExchangeService', () => {
  let service: ExchangeService;

  beforeEach(async () => {
    // const module: TestingModule = await Test.createTestingModule({
    //   providers: [ExchangeService],
    // }).compile();

    // service = module.get<ExchangeService>(ExchangeService);

    service = new ExchangeService(new kraken({}));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return BTC/EUR and buy', () => {
    expect(service.getCurrencyPair('EUR', 'BTC')).toEqual({pair: 'BTC/EUR', direction: OrderSide.BUY});
  });

  it('should return BTC/EUR and sell', () => {
    expect(service.getCurrencyPair('BTC', 'EUR')).toEqual({pair: 'BTC/EUR', direction: OrderSide.SELL});
  });

  it('should return correct weighted average', () => {
    const list = [{price: 0.1, amount: 3}, {price: 1.2, amount: 2}];
    expect(service.getWeightedAveragePrice(list)).toEqual({avgPrice: 0.54, amountSum: 5});
  })
});
