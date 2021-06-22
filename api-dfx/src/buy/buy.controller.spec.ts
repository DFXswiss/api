import { Test, TestingModule } from '@nestjs/testing';
import { BuyController } from './buy.controller';

describe('BuyController', () => {
  let controller: BuyController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BuyController],
    }).compile();

    controller = module.get<BuyController>(BuyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
