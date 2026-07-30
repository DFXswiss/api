import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Setting } from 'src/shared/models/setting/setting.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { StatisticService } from 'src/subdomains/core/statistic/statistic.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';

describe('StatisticService', () => {
  let service: StatisticService;
  let settingService: jest.Mocked<SettingService>;

  beforeEach(async () => {
    settingService = createMock<SettingService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatisticService,
        { provide: BuyService, useValue: createMock<BuyService>() },
        { provide: SellService, useValue: createMock<SellService>() },
        { provide: SettingService, useValue: settingService },
        { provide: UserService, useValue: createMock<UserService>() },
      ],
    }).compile();

    service = module.get(StatisticService);
  });

  describe('getStatus', () => {
    it('loads only status settings', async () => {
      settingService.getStatusSettings.mockResolvedValue([]);

      await service.getStatus();

      expect(settingService.getStatusSettings).toHaveBeenCalled();
      expect(settingService.getAll).not.toHaveBeenCalled();
    });

    it('maps status settings to status keys and values', async () => {
      settingService.getStatusSettings.mockResolvedValue([
        Object.assign(new Setting(), { key: 'buyStatus', value: 'Available' }),
        Object.assign(new Setting(), { key: 'sellStatus', value: 'Limited' }),
      ]);

      await expect(service.getStatus()).resolves.toEqual({ buy: 'Available', sell: 'Limited' });
    });

    it('returns an empty object when there are no status settings', async () => {
      settingService.getStatusSettings.mockResolvedValue([]);

      await expect(service.getStatus()).resolves.toEqual({});
    });
  });
});
