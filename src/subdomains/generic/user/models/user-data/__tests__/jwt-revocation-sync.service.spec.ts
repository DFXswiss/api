import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { FindOperator, In } from 'typeorm';
import { JwtRevocationSyncService } from '../jwt-revocation-sync.service';
import { UserData } from '../user-data.entity';
import { RiskStatus, UserDataStatus } from '../user-data.enum';
import { UserDataRepository } from '../user-data.repository';

describe('JwtRevocationSyncService', () => {
  let service: JwtRevocationSyncService;
  let userDataRepo: jest.Mocked<UserDataRepository>;
  let settingService: jest.Mocked<SettingService>;

  beforeEach(async () => {
    userDataRepo = createMock<UserDataRepository>();
    settingService = createMock<SettingService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtRevocationSyncService,
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: SettingService, useValue: settingService },
      ],
    }).compile();

    service = module.get(JwtRevocationSyncService);
  });

  describe('syncDeniedJwtAccounts', () => {
    it('writes exactly the ids of blocked/deactivated/suspicious accounts to jwtAccountDenylistAuto', async () => {
      userDataRepo.find.mockResolvedValue([
        Object.assign(new UserData(), { id: 3 }),
        Object.assign(new UserData(), { id: 7 }),
      ]);

      await service.syncDeniedJwtAccounts();

      expect(settingService.setObj).toHaveBeenCalledWith('jwtAccountDenylistAuto', [3, 7]);
    });

    it('writes an empty array when no account is blocked', async () => {
      userDataRepo.find.mockResolvedValue([]);

      await service.syncDeniedJwtAccounts();

      expect(settingService.setObj).toHaveBeenCalledWith('jwtAccountDenylistAuto', []);
    });

    it('filters in SQL on blocking status OR risk status and selects only the id', async () => {
      userDataRepo.find.mockResolvedValue([]);

      await service.syncDeniedJwtAccounts();

      const options = userDataRepo.find.mock.calls[0][0];
      expect(options.select).toEqual({ id: true });

      const where = options.where as [
        { status: FindOperator<UserDataStatus> },
        { riskStatus: FindOperator<RiskStatus> },
      ];
      expect(where[0].status).toEqual(In([UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED]));
      expect(where[1].riskStatus).toEqual(In([RiskStatus.BLOCKED, RiskStatus.SUSPICIOUS]));
    });
  });
});
