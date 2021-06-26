import { Test, TestingModule } from '@nestjs/testing';
import { AllController } from './all.controller';

describe('AllController', () => {
  let controller: AllController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AllController],
    }).compile();

    controller = module.get<AllController>(AllController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
