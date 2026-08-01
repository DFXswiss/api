import { HasStaffKycClearance, SetStaffKycClearance } from 'src/shared/auth/staff-kyc-clearance';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { IsJwtAccountDenied, ProcessService } from 'src/shared/services/process.service';

describe('ProcessService JWT account denylist', () => {
  let settingService: jest.Mocked<SettingService>;
  let service: ProcessService;

  beforeEach(() => {
    settingService = {
      getDeniedJwtAccounts: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SettingService>;

    service = new ProcessService(settingService);
  });

  afterEach(async () => {
    // reset the shared module-level denylist so state does not leak between tests
    settingService.getDeniedJwtAccounts.mockResolvedValue([]);
    await service.resyncDeniedJwtAccounts();
  });

  it('denies an account id present in the setting', async () => {
    settingService.getDeniedJwtAccounts.mockResolvedValue([123, 456]);
    await service.resyncDeniedJwtAccounts();

    expect(IsJwtAccountDenied(123)).toBe(true);
    expect(IsJwtAccountDenied(456)).toBe(true);
  });

  it('allows an account id not present in the setting', async () => {
    settingService.getDeniedJwtAccounts.mockResolvedValue([123]);
    await service.resyncDeniedJwtAccounts();

    expect(IsJwtAccountDenied(999)).toBe(false);
  });

  it('allows an undefined account (addressless tokens are not implicitly denied)', async () => {
    settingService.getDeniedJwtAccounts.mockResolvedValue([123]);
    await service.resyncDeniedJwtAccounts();

    expect(IsJwtAccountDenied(undefined)).toBe(false);
  });

  it('fails open on an empty denylist', async () => {
    await service.resyncDeniedJwtAccounts();

    expect(IsJwtAccountDenied(123)).toBe(false);
  });
});

describe('ProcessService staff KYC clearance priming', () => {
  let settingService: jest.Mocked<SettingService>;
  let service: ProcessService;

  beforeEach(() => {
    settingService = {
      getStaffKycClearance: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SettingService>;

    service = new ProcessService(settingService);
  });

  afterEach(() => SetStaffKycClearance([]));

  it('primes the in-memory clearance Set from the setting', async () => {
    settingService.getStaffKycClearance.mockResolvedValue([123, 456]);

    await service.resyncStaffKycClearance();

    expect(HasStaffKycClearance(123)).toBe(true);
    expect(HasStaffKycClearance(456)).toBe(true);
    expect(HasStaffKycClearance(999)).toBe(false);
  });

  it('drops a revoked account on the next resync', async () => {
    settingService.getStaffKycClearance.mockResolvedValue([123]);
    await service.resyncStaffKycClearance();

    settingService.getStaffKycClearance.mockResolvedValue([]);
    await service.resyncStaffKycClearance();

    expect(HasStaffKycClearance(123)).toBe(false);
  });
});
