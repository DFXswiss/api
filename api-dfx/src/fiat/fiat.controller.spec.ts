import { Test, TestingModule } from '@nestjs/testing';
import { FiatController } from './fiat.controller';

describe('FiatController', () => {
  let controller: FiatController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FiatController],
    }).compile();

    controller = module.get<FiatController>(FiatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
