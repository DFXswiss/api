import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { LogRepository } from '../log.repository';
import { LogService } from '../log.service';

describe('LogService', () => {
  let service: LogService;
  let logRepo: LogRepository;
  let settingService: SettingService;

  beforeEach(async () => {
    logRepo = createMock<LogRepository>();
    settingService = createMock<SettingService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        LogService,
        { provide: LogRepository, useValue: logRepo },
        { provide: SettingService, useValue: settingService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<LogService>(LogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('setFinancialLogValidity', () => {
    it('should throw if no filter is provided', async () => {
      await expect(service.setFinancialLogValidity({ valid: false })).rejects.toThrow(BadRequestException);
    });

    it('should throw if from is after to', async () => {
      await expect(
        service.setFinancialLogValidity({ valid: false, from: new Date('2026-06-19'), to: new Date('2026-06-18') }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if min is not smaller than max', async () => {
      await expect(service.setFinancialLogValidity({ valid: false, min: 60000, max: 60000 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delegate to the repository and return the affected count', async () => {
      jest.spyOn(logRepo, 'setFinancialLogValidity').mockResolvedValue(7);

      const dto = { valid: false, from: new Date('2026-06-18'), min: 60000 };
      const result = await service.setFinancialLogValidity(dto);

      expect(logRepo.setFinancialLogValidity).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ affected: 7 });
    });
  });
});
