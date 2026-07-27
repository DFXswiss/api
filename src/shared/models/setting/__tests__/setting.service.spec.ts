import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Setting } from '../setting.entity';
import { SettingRepository } from '../setting.repository';
import { SettingService } from '../setting.service';

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
