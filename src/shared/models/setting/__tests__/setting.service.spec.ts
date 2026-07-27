import { ForbiddenException } from '@nestjs/common';
import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Setting } from '../setting.entity';
import { SettingRepository } from '../setting.repository';
import { SettingService, SystemManagedSettings } from '../setting.service';

describe('SettingService', () => {
  let service: SettingService;
  let settingRepo: jest.Mocked<SettingRepository>;

  function mockSettings(values: Record<string, unknown>): void {
    settingRepo.findOneBy.mockImplementation(async ({ key }: { key: string }) =>
      key in values ? Object.assign(new Setting(), { key, value: JSON.stringify(values[key]) }) : null,
    );
  }

  beforeEach(async () => {
    settingRepo = createMock<SettingRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SettingService, { provide: SettingRepository, useValue: settingRepo }],
    }).compile();

    service = module.get(SettingService);
  });

  describe('setDateMax', () => {
    it('delegates a valid candidate to the atomic repository operation', async () => {
      const candidate = new Date('2026-07-11T12:00:00.000Z');

      await service.setDateMax('lastBankFrickDate:1', candidate);

      expect(settingRepo.setDateMax).toHaveBeenCalledWith('lastBankFrickDate:1', candidate);
    });

    it.each([new Date('invalid'), undefined])('rejects an invalid candidate %s', async (candidate) => {
      await expect(service.setDateMax('lastBankFrickDate:1', candidate as Date)).rejects.toThrow(
        "Setting 'lastBankFrickDate:1' requires a valid date",
      );
      expect(settingRepo.setDateMax).not.toHaveBeenCalled();
    });
  });

  describe('getDeniedJwtAccounts', () => {
    it('returns the deduped union of the manual and auto denylists as numbers', async () => {
      mockSettings({ jwtAccountDenylist: [1], jwtAccountDenylistAuto: [2, 2, 3] });

      await expect(service.getDeniedJwtAccounts()).resolves.toEqual([1, 2, 3]);
    });

    it('dedupes ids present in both the manual and auto denylists', async () => {
      mockSettings({ jwtAccountDenylist: [1, 2], jwtAccountDenylistAuto: [2, 3] });

      await expect(service.getDeniedJwtAccounts()).resolves.toEqual([1, 2, 3]);
    });

    it('coerces string ids to numbers', async () => {
      mockSettings({ jwtAccountDenylist: ['1'], jwtAccountDenylistAuto: ['2'] });

      await expect(service.getDeniedJwtAccounts()).resolves.toEqual([1, 2]);
    });

    it('returns an empty array when both settings are missing', async () => {
      mockSettings({});

      await expect(service.getDeniedJwtAccounts()).resolves.toEqual([]);
    });

    it('returns only the auto denylist when the manual override is unset', async () => {
      mockSettings({ jwtAccountDenylistAuto: [5, 6] });

      await expect(service.getDeniedJwtAccounts()).resolves.toEqual([5, 6]);
    });
  });

  describe('set', () => {
    it('writes an ordinary setting', async () => {
      await service.set('someOpsFlag', 'true');

      expect(settingRepo.save).toHaveBeenCalled();
    });

    // `staffKycClearance` decides who reaches every elevated endpoint and is derived from KYC data by a
    // sync job. A manual write through the generic setter would grant elevated access to accounts that
    // never passed KYC, and would stay live until the next sync run overwrote it. The check sits here
    // rather than in the controller so every caller of `set` is covered, not just the HTTP route.
    describe.each(SystemManagedSettings)('system-managed setting %s', (key) => {
      it('is rejected, without writing', async () => {
        await expect(service.set(key, '[1,2,3]')).rejects.toBeInstanceOf(ForbiddenException);

        expect(settingRepo.save).not.toHaveBeenCalled();
      });
    });

    it('lists staffKycClearance as system-managed', () => {
      expect(SystemManagedSettings).toContain('staffKycClearance');
    });

    // The sync path writes through `setObj`, which goes to the repository directly — blocking it would
    // freeze the allowlist at whatever it happened to contain.
    it('still allows the sync path to write the clearance through setObj', async () => {
      await service.setObj('staffKycClearance', [1, 2]);

      expect(settingRepo.save).toHaveBeenCalled();
    });
  });

  describe('getStaffKycClearance', () => {
    it('returns the cleared account ids', async () => {
      mockSettings({ staffKycClearance: [1, 2] });

      await expect(service.getStaffKycClearance()).resolves.toEqual([1, 2]);
    });

    it('coerces string ids to numbers', async () => {
      mockSettings({ staffKycClearance: ['1', '2'] });

      await expect(service.getStaffKycClearance()).resolves.toEqual([1, 2]);
    });

    // Fail-closed: a missing setting must read as "nobody is cleared", never as "no restriction".
    it('returns an empty array when the setting is missing', async () => {
      mockSettings({});

      await expect(service.getStaffKycClearance()).resolves.toEqual([]);
    });
  });
});
