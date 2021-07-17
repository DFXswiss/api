import { Test, TestingModule } from '@nestjs/testing';
import { StatisticController } from './statistic.controller';

describe('StatisticController', () => {
  let controller: StatisticController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatisticController],
    }).compile();

    controller = module.get<StatisticController>(StatisticController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
