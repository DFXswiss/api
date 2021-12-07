import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { FiatController } from './fiat.controller';
import { FiatService } from './fiat.service';

describe('FiatController', () => {
  let controller: FiatController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      controllers: [FiatController],
      providers: [{ provide: FiatService, useValue: {} }],
    }).compile();

    controller = module.get<FiatController>(FiatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
