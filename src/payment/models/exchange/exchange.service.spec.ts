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
    expect(service.currencyPairFromTo('EUR', 'BTC')).toEqual(['BTC/EUR', OrderSide.BUY]);
  });

  it('should return BTC/EUR and sell', () => {
    expect(service.currencyPairFromTo('BTC', 'EUR')).toEqual(['BTC/EUR', OrderSide.SELL]);
  });
});
