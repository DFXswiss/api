import { Test, TestingModule } from '@nestjs/testing';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { StaffKycClearanceService } from '../staff-kyc-clearance.service';
import { UserRepository } from '../user.repository';

describe('StaffKycClearanceService', () => {
  let service: StaffKycClearanceService;
  let userRepo: UserRepository;
  let settingService: SettingService;

  function setup(users: unknown[]): void {
    jest.spyOn(userRepo, 'find').mockResolvedValue(users as never);
  }

  function staffUser(accountId: number, verifiedName?: string): unknown {
    return { id: accountId * 10, userData: { id: accountId, verifiedName } };
  }

  beforeEach(async () => {
    userRepo = { find: jest.fn() } as unknown as UserRepository;
    settingService = { setObj: jest.fn() } as unknown as SettingService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffKycClearanceService,
        { provide: UserRepository, useValue: userRepo },
        { provide: SettingService, useValue: settingService },
      ],
    }).compile();

    service = module.get<StaffKycClearanceService>(StaffKycClearanceService);
  });

  afterEach(() => jest.resetAllMocks());

  it('writes the cleared account ids to the staffKycClearance setting', async () => {
    setup([staffUser(11, 'Alice Example'), staffUser(12, 'Bob Example')]);

    await service.syncStaffKycClearance();

    expect(settingService.setObj).toHaveBeenCalledWith('staffKycClearance', [11, 12]);
  });

  it('excludes accounts without a verified name', async () => {
    setup([staffUser(11, 'Alice Example'), staffUser(12, undefined), staffUser(13, null as unknown as string)]);

    await service.syncStaffKycClearance();

    expect(settingService.setObj).toHaveBeenCalledWith('staffKycClearance', [11]);
  });

  it('treats an empty or whitespace-only verified name as absent', async () => {
    setup([staffUser(11, ''), staffUser(12, '   '), staffUser(13, 'Carol Example')]);

    await service.syncStaffKycClearance();

    expect(settingService.setObj).toHaveBeenCalledWith('staffKycClearance', [13]);
  });

  it('deduplicates accounts backing several staff users', async () => {
    // One person can hold multiple staff wallets pointing at the same user data.
    setup([staffUser(11, 'Alice Example'), staffUser(11, 'Alice Example')]);

    await service.syncStaffKycClearance();

    expect(settingService.setObj).toHaveBeenCalledWith('staffKycClearance', [11]);
  });

  it('writes an empty list when nobody qualifies — the gate is fail-closed', async () => {
    setup([]);

    await service.syncStaffKycClearance();

    expect(settingService.setObj).toHaveBeenCalledWith('staffKycClearance', []);
  });

  it('queries only staff roles and kycLevel >= 50', async () => {
    setup([]);

    await service.syncStaffKycClearance();

    const where = (userRepo.find as jest.Mock).mock.calls[0][0].where;
    expect(where.role._value).toEqual(expect.arrayContaining(['Admin', 'SuperAdmin', 'Debug', 'RealUnit']));
    expect(where.role._value).not.toContain('User');
    expect(where.userData.kycLevel._value).toBe(50);
  });

  it('does not swallow a repository failure — a failed sync must keep the last known Set', async () => {
    jest.spyOn(userRepo, 'find').mockRejectedValue(new Error('db down'));

    await expect(service.syncStaffKycClearance()).rejects.toThrow('db down');
    expect(settingService.setObj).not.toHaveBeenCalled();
  });
});
