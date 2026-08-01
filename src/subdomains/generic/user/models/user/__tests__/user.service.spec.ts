import { ForbiddenException } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserService } from '../user.service';

// Focused on the write-side clearance invariant in `updateUserInternal`: an account may only be given a
// gated role when a verified name is already behind it. The guard reads only `userRepo`, so the service
// is constructed with a mock repository and inert stubs for the other collaborators.
describe('UserService — elevated role assignment guard', () => {
  let service: UserService;
  let userRepo: { findOne: jest.Mock; save: jest.Mock };

  function userWith(verifiedName: string | null | undefined, loaded = true): any {
    const userData = { id: 7, verifiedName };
    return { id: 42, userData: loaded ? userData : undefined };
  }

  beforeEach(() => {
    userRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((u) => Promise.resolve(u)),
    };
    // Only userRepo participates in this path; the remaining collaborators are never reached.
    service = new UserService(
      userRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('rejects a gated role when the account has no verified name', async () => {
    await expect(service.updateUserInternal(userWith(null), { role: UserRole.DEBUG })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a gated role when the verified name is blank whitespace', async () => {
    await expect(service.updateUserInternal(userWith('  \t'), { role: UserRole.ADMIN })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('allows a gated role when a verified name is present', async () => {
    await service.updateUserInternal(userWith('Jane Doe'), { role: UserRole.SUPPORT });
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });

  it('reloads userData when the relation was not hydrated, then allows on a present name', async () => {
    userRepo.findOne.mockResolvedValue({ userData: { id: 7, verifiedName: 'Jane Doe' } });

    await service.updateUserInternal(userWith(undefined, false), { role: UserRole.DEBUG });

    expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: 42 }, relations: { userData: true } });
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });

  it('does not gate a non-elevated role even without a verified name', async () => {
    await service.updateUserInternal(userWith(null), { role: UserRole.USER });
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });
});
