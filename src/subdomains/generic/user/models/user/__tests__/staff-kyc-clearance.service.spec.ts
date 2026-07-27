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

  // Rows as the DB returns them: the role / kycLevel / verifiedName filtering has already happened in
  // SQL, so a returned row is by definition a cleared one.
  function staffUser(accountId: number): unknown {
    return { id: accountId * 10, userData: { id: accountId } };
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
    setup([staffUser(11), staffUser(12)]);

    await service.syncStaffKycClearance();

    expect(settingService.setObj).toHaveBeenCalledWith('staffKycClearance', [11, 12]);
  });

  // Accounts without a usable verifiedName (NULL, empty or whitespace-only) are excluded by the SQL
  // predicate, not in JS — so the assertion has to be on the query. `TRIM(...) <> ''` also drops NULL,
  // because the comparison yields NULL rather than true.
  it('excludes names that are NULL, empty or whitespace-only via a SQL predicate', async () => {
    setup([]);

    await service.syncStaffKycClearance();

    const verifiedName = (userRepo.find as jest.Mock).mock.calls[0][0].where.userData.verifiedName;
    expect(verifiedName.type).toBe('raw');
    // The alias must be interpolated verbatim: TypeORM passes it in already quoted, and on Postgres an
    // unquoted camelCase identifier would be folded to lowercase and blow up at runtime.
    expect(verifiedName.getSql('"UserData"."verifiedName"')).toBe(`TRIM("UserData"."verifiedName") <> ''`);
  });

  it('deduplicates accounts backing several staff users', async () => {
    // One person can hold multiple staff wallets pointing at the same user data.
    setup([staffUser(11), staffUser(11)]);

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
