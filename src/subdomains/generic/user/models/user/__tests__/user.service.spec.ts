import { createMock } from '@golevelup/ts-jest';
import { ForbiddenException } from '@nestjs/common';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { UserData } from '../../user-data/user-data.entity';
import { User } from '../user.entity';
import { UserRepository } from '../user.repository';
import { UserService } from '../user.service';

// Focused on the write-side clearance invariant in `updateUserInternal`: an account may only be given a
// gated role when a verified name is already behind it. Only `userRepo` participates in this path; the
// remaining collaborators are typed mocks so a future constructor reorder fails the compiler instead of
// silently wiring the service with dependencies in the wrong slots.
describe('UserService — elevated role assignment guard', () => {
  let service: UserService;
  let userRepo: jest.Mocked<UserRepository>;

  function userWith(verifiedName: string | null | undefined, loaded = true): User {
    const userData = createMock<UserData>({ id: 7, verifiedName: verifiedName ?? undefined });
    return createMock<User>({ id: 42, userData: loaded ? userData : undefined });
  }

  beforeEach(() => {
    userRepo = createMock<UserRepository>();
    userRepo.save.mockImplementation((entity) => Promise.resolve(entity as User));

    service = new UserService(
      userRepo,
      createMock<UserDataRepository>(),
      createMock<UserDataService>(),
      createMock<WalletService>(),
      createMock<GeoLocationService>(),
      createMock<FeeService>(),
      createMock<LanguageService>(),
      createMock<FiatService>(),
      createMock<SiftService>(),
      createMock<AssetService>(),
    );
  });

  it('rejects a gated role when the account has no verified name', async () => {
    await expect(service.updateUserInternal(userWith(null), { role: UserRole.DEBUG })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  // SUPER_ADMIN is not itself in KycGatedRoles but satisfies every gate through the role hierarchy, so the
  // guard must cover it exactly as the clearance query does — otherwise the highest privilege of all could
  // be assigned to a faceless account.
  it('rejects a super-role (SUPER_ADMIN) when the account has no verified name', async () => {
    await expect(service.updateUserInternal(userWith(null), { role: UserRole.SUPER_ADMIN })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a gated role when the verified name is blank whitespace', async () => {
    await expect(service.updateUserInternal(userWith('  \t'), { role: UserRole.ADMIN })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('allows a gated role when a verified name is present', async () => {
    await service.updateUserInternal(userWith('Jane Doe'), { role: UserRole.SUPPORT });
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });

  it('reloads userData when the relation was not hydrated, then allows on a present name', async () => {
    userRepo.findOne.mockResolvedValue(
      createMock<User>({ userData: createMock<UserData>({ verifiedName: 'Jane Doe' }) }),
    );

    await service.updateUserInternal(userWith(undefined, false), { role: UserRole.DEBUG });

    expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: 42 }, relations: { userData: true } });
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });

  it('does not gate a non-elevated role even without a verified name', async () => {
    await service.updateUserInternal(userWith(null), { role: UserRole.USER });
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });
});
