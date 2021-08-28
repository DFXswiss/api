import { Test, TestingModule } from '@nestjs/testing';
import { AllDataController } from './all.controller';

describe('AllController', () => {
  let controller: AllDataController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AllDataController],
    }).compile();

    controller = module.get<AllDataController>(AllDataController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
