import { ForbiddenException } from '@nestjs/common';
import { SettingController } from '../setting.controller';
import { SettingService, SystemManagedSettings } from '../setting.service';

describe('SettingController generic setter', () => {
  let controller: SettingController;
  let settingService: jest.Mocked<SettingService>;

  beforeEach(() => {
    settingService = { set: jest.fn() } as unknown as jest.Mocked<SettingService>;
    controller = new SettingController(settingService);
  });

  it('writes an ordinary setting', async () => {
    await controller.updateSetting('someOpsFlag', { value: 'true' });

    expect(settingService.set).toHaveBeenCalledWith('someOpsFlag', 'true');
  });

  // `staffKycClearance` decides who reaches every elevated endpoint. It is derived from KYC data by a
  // sync job; a manual write here would grant elevated access to accounts that never passed KYC, and it
  // would stay live until the next sync run overwrites it.
  describe.each(SystemManagedSettings)('system-managed setting %s', (key) => {
    it('is rejected, without reaching the service', async () => {
      await expect(controller.updateSetting(key, { value: '[1,2,3]' })).rejects.toBeInstanceOf(ForbiddenException);

      expect(settingService.set).not.toHaveBeenCalled();
    });
  });

  it('lists staffKycClearance as system-managed', () => {
    expect(SystemManagedSettings).toContain('staffKycClearance');
  });
});
