import { UnauthorizedException } from '@nestjs/common';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { JwtStrategy } from 'src/shared/auth/jwt.strategy';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { ProcessService } from 'src/shared/services/process.service';

describe('JwtStrategy account denylist', () => {
  let settingService: jest.Mocked<SettingService>;
  let processService: ProcessService;

  // validate() reads no instance state, so exercise it off the prototype to avoid the passport-jwt
  // constructor (which requires a JWT secret from the environment).
  const validate = (payload: JwtPayload): Promise<JwtPayload> =>
    JwtStrategy.prototype.validate.call({} as JwtStrategy, payload);

  const accountPayload = (account: number): JwtPayload => ({
    account,
    role: UserRole.ACCOUNT,
    ip: '1.1.1.1',
  });

  beforeEach(() => {
    settingService = {
      getDeniedJwtAddresses: jest.fn().mockResolvedValue([]),
      getDeniedJwtAccounts: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SettingService>;

    processService = new ProcessService(settingService);
  });

  afterEach(async () => {
    // reset the shared module-level denylists so state does not leak between tests
    settingService.getDeniedJwtAddresses.mockResolvedValue([]);
    settingService.getDeniedJwtAccounts.mockResolvedValue([]);
    await processService.resyncDeniedJwtAddresses();
    await processService.resyncDeniedJwtAccounts();
  });

  it('rejects an addressless account token whose account id is denied', async () => {
    settingService.getDeniedJwtAccounts.mockResolvedValue([42]);
    await processService.resyncDeniedJwtAccounts();

    await expect(validate(accountPayload(42))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts an account token whose account id is not denied', async () => {
    settingService.getDeniedJwtAccounts.mockResolvedValue([42]);
    await processService.resyncDeniedJwtAccounts();

    const payload = accountPayload(7);
    await expect(validate(payload)).resolves.toEqual(payload);
  });
});
