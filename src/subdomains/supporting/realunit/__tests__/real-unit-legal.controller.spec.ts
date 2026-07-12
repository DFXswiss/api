import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { RealUnitLegalController } from '../controllers/real-unit-legal.controller';
import { AcceptRealUnitLegalDto, RealUnitLegalInfoDto } from '../dto/real-unit-legal.dto';
import { RealUnitLegalAgreement } from '../enums/real-unit-legal-agreement.enum';
import { RealUnitLegalService } from '../real-unit-legal.service';

describe('RealUnitLegalController', () => {
  let controller: RealUnitLegalController;
  let legalService: DeepMocked<RealUnitLegalService>;
  let userService: DeepMocked<UserService>;

  const jwt = createMock<JwtPayload>({ user: 42 });
  const userData = Object.assign(new UserData(), { id: 7 });
  const info: RealUnitLegalInfoDto = { agreements: [], allAccepted: false };

  beforeEach(() => {
    legalService = createMock<RealUnitLegalService>();
    userService = createMock<UserService>();
    controller = new RealUnitLegalController(legalService, userService);

    userService.getUser.mockResolvedValue(Object.assign(new User(), { userData }));
  });

  describe('getLegal', () => {
    it('resolves the userData from the jwt and returns the service legal info', async () => {
      legalService.getLegalInfo.mockResolvedValue(info);

      await expect(controller.getLegal(jwt)).resolves.toBe(info);

      expect(userService.getUser).toHaveBeenCalledWith(jwt.user, { userData: true });
      expect(legalService.getLegalInfo).toHaveBeenCalledWith(userData);
    });
  });

  describe('acceptLegal', () => {
    it('records the acceptance for the jwt user and returns the updated info', async () => {
      const dto: AcceptRealUnitLegalDto = { agreements: [RealUnitLegalAgreement.DFX_TERMS_AND_CONDITIONS] };
      legalService.acceptLegal.mockResolvedValue(info);

      await expect(controller.acceptLegal(jwt, dto)).resolves.toBe(info);

      expect(userService.getUser).toHaveBeenCalledWith(jwt.user, { userData: true });
      expect(legalService.acceptLegal).toHaveBeenCalledWith(userData, dto.agreements);
    });
  });
});
