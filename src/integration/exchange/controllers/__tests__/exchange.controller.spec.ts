import { ExchangeController } from '../exchange.controller';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { ExchangeRegistryService } from '../../services/exchange-registry.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { createMock } from '@golevelup/ts-jest';
import { PartialTradeResponse } from '../../dto/trade-response.dto';

describe('ExchangeController', () => {
  let controller: ExchangeController;

  let exchangeRegistryService: ExchangeRegistryService;

  beforeEach(async () => {
    exchangeRegistryService = createMock<ExchangeRegistryService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        ExchangeController,
        { provide: ExchangeRegistryService, useValue: exchangeRegistryService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<ExchangeController>(ExchangeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return correct weighted average', () => {
    const list = [
      { price: 0.1, toAmount: 3.8, fee: { cost: 2.3 } },
      { price: 1.2, toAmount: 1.4, fee: { cost: 1.4 } },
    ] as PartialTradeResponse[];
    expect(controller['getWeightedAveragePrice'](list)).toEqual({ price: 0.39615385, amountSum: 5.2, feeSum: 3.7 });
  });
});
