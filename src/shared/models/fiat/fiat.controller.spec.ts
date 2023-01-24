import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { FiatController } from './fiat.controller';
import { Fiat } from './fiat.entity';
import { FiatService } from './fiat.service';

describe('FiatController', () => {
  let controller: FiatController;

  let fiatService: FiatService;

  beforeEach(async () => {
    fiatService = createMock<FiatService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      controllers: [FiatController],
      providers: [{ provide: FiatService, useValue: fiatService }],
    }).compile();

    controller = module.get<FiatController>(FiatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return fiat list', async () => {
    const fiatList = [{ id: 1 }, { id: 2 }] as Fiat[];

    jest.spyOn(fiatService, 'getAllFiat').mockResolvedValueOnce(fiatList);

    await expect(controller.getAllFiat()).resolves.toEqual(fiatList);
  });
});
