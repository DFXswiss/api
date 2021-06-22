import { Test, TestingModule } from '@nestjs/testing';
import { SellController } from './sell.controller';

describe('BuyController', () => {
  let controller: SellController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SellController],
    }).compile();

    controller = module.get<SellController>(SellController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
