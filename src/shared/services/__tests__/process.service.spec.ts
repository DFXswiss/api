import { HasStaffKycClearance, SetStaffKycClearance } from 'src/shared/auth/staff-kyc-clearance';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { ConfigService } from 'src/config/config';
import {
  DisabledProcess,
  IsJwtAccountDenied,
  IsJwtAddressDenied,
  Process,
  ProcessService,
} from 'src/shared/services/process.service';

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

describe('ProcessService JWT address denylist', () => {
  let settingService: jest.Mocked<SettingService>;
  let service: ProcessService;

  beforeEach(() => {
    settingService = {
      getDeniedJwtAddresses: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SettingService>;

    service = new ProcessService(settingService);
  });

  afterEach(async () => {
    settingService.getDeniedJwtAddresses.mockResolvedValue([]);
    await service.resyncDeniedJwtAddresses();
  });

  it('denies a listed address regardless of the case it is written in', async () => {
    settingService.getDeniedJwtAddresses.mockResolvedValue(['0xAbC']);
    await service.resyncDeniedJwtAddresses();

    expect(IsJwtAddressDenied('0xabc')).toBe(true);
    expect(IsJwtAddressDenied('0xABC')).toBe(true);
  });

  it('allows an address that is not listed', async () => {
    settingService.getDeniedJwtAddresses.mockResolvedValue(['0xabc']);
    await service.resyncDeniedJwtAddresses();

    expect(IsJwtAddressDenied('0xdef')).toBe(false);
  });

  it('allows an undefined address — an addressless token is not implicitly denied', async () => {
    settingService.getDeniedJwtAddresses.mockResolvedValue(['0xabc']);
    await service.resyncDeniedJwtAddresses();

    expect(IsJwtAddressDenied(undefined)).toBe(false);
  });

  it('fails open on an empty denylist', async () => {
    await service.resyncDeniedJwtAddresses();

    expect(IsJwtAddressDenied('0xabc')).toBe(false);
  });
});

describe('ProcessService disabled processes', () => {
  let settingService: jest.Mocked<SettingService>;
  let service: ProcessService;

  function setting(overrides: Partial<jest.Mocked<SettingService>> = {}): jest.Mocked<SettingService> {
    return {
      getDisabledProcesses: jest.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as jest.Mocked<SettingService>;
  }

  const originalEnv = process.env.DISABLED_PROCESSES;

  beforeEach(() => {
    // Config is module-level state that only ConfigService assigns; constructing one is how a unit
    // test gets a real Configuration without booting a Nest module.
    new ConfigService();
    delete process.env.DISABLED_PROCESSES;
    settingService = setting();
    service = new ProcessService(settingService);
  });

  afterEach(async () => {
    // The map is module-level state; leave it permissive so unrelated suites are unaffected.
    if (originalEnv === undefined) delete process.env.DISABLED_PROCESSES;
    else process.env.DISABLED_PROCESSES = originalEnv;
    settingService.getDisabledProcesses.mockResolvedValue([]);
    await service.resyncDisabledProcesses();
  });

  it('disables what the database setting lists', async () => {
    settingService.getDisabledProcesses.mockResolvedValue([Process.BANK_TX]);

    await service.resyncDisabledProcesses();

    expect(DisabledProcess(Process.BANK_TX)).toBe(true);
    expect(DisabledProcess(Process.FIAT_OUTPUT)).toBe(false);
  });

  it('disables what the environment lists, alongside the setting', async () => {
    settingService.getDisabledProcesses.mockResolvedValue([Process.BANK_TX]);
    process.env.DISABLED_PROCESSES = Process.FIAT_OUTPUT;

    await service.resyncDisabledProcesses();

    expect(DisabledProcess(Process.BANK_TX)).toBe(true);
    expect(DisabledProcess(Process.FIAT_OUTPUT)).toBe(true);
  });

  it('disables everything when the environment says so', async () => {
    process.env.DISABLED_PROCESSES = '*';

    await service.resyncDisabledProcesses();

    expect(DisabledProcess(Process.BANK_TX)).toBe(true);
    expect(DisabledProcess(Process.FIAT_OUTPUT)).toBe(true);
  });

  it('re-enables a process once it is dropped from both sources', async () => {
    settingService.getDisabledProcesses.mockResolvedValue([Process.BANK_TX]);
    await service.resyncDisabledProcesses();

    settingService.getDisabledProcesses.mockResolvedValue([]);
    await service.resyncDisabledProcesses();

    expect(DisabledProcess(Process.BANK_TX)).toBe(false);
  });

  describe('safety mode', () => {
    it('is inactive until it is switched on', () => {
      expect(service.isSafetyModeActive()).toBe(false);
    });

    it('disables the safety-mode process group while active', async () => {
      await service.setSafetyModeActive(true);

      expect(service.isSafetyModeActive()).toBe(true);
      expect(DisabledProcess(Process.CRYPTO_PAYOUT)).toBe(true);
      expect(DisabledProcess(Process.TRADING)).toBe(true);
      // A process outside the group is unaffected.
      expect(DisabledProcess(Process.BANK_TX)).toBe(false);
    });

    it('releases the group again when switched off', async () => {
      await service.setSafetyModeActive(true);
      await service.setSafetyModeActive(false);

      expect(service.isSafetyModeActive()).toBe(false);
      expect(DisabledProcess(Process.CRYPTO_PAYOUT)).toBe(false);
    });

    it('refuses to activate while its own kill switch is disabled', async () => {
      // SAFETY_MODE itself being disabled means the mode must not engage — otherwise switching the
      // feature off would be impossible from the outside.
      settingService.getDisabledProcesses.mockResolvedValue([Process.SAFETY_MODE]);
      await service.resyncDisabledProcesses();

      await service.setSafetyModeActive(true);

      expect(service.isSafetyModeActive()).toBe(false);
      expect(DisabledProcess(Process.CRYPTO_PAYOUT)).toBe(false);
    });
  });
});

describe('ProcessService boot priming', () => {
  it('primes both denylists and the clearance set, and starts the disabled-process sync', async () => {
    const settingService = {
      getDisabledProcesses: jest.fn().mockResolvedValue([]),
      getDeniedJwtAddresses: jest.fn().mockResolvedValue([]),
      getDeniedJwtAccounts: jest.fn().mockResolvedValue([]),
      getStaffKycClearance: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SettingService>;
    new ConfigService();
    const service = new ProcessService(settingService);

    await service.onModuleInit();

    // The three awaited ones must be primed before HTTP starts: the clearance set is fail-closed, and
    // the denylists fail open, so serving requests before either is loaded is a real decision.
    expect(settingService.getDeniedJwtAddresses).toHaveBeenCalled();
    expect(settingService.getDeniedJwtAccounts).toHaveBeenCalled();
    expect(settingService.getStaffKycClearance).toHaveBeenCalled();
    expect(settingService.getDisabledProcesses).toHaveBeenCalled();
  });
});
