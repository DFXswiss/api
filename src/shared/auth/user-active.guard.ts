import { CanActivate, ExecutionContext } from '@nestjs/common';
import { UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';

class UserActiveGuardClass implements CanActivate {
  constructor(
    private readonly blockedUserStatus?: UserStatus[],
    private readonly blockedUserDataStatus?: UserDataStatus[],
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userStatus = req.user.userStatus;
    const accountStatus = req.user.accountStatus;

    return this.blockedUserDataStatus || this.blockedUserStatus
      ? !this.blockedUserStatus.includes(userStatus) && !this.blockedUserDataStatus.includes(accountStatus)
      : ![UserStatus.BLOCKED, UserStatus.DELETED].includes(userStatus) &&
          ![UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED].includes(accountStatus);
  }
}

export function UserActiveGuard(
  blockedUserStatus?: UserStatus[],
  blockedUserDataStatus?: UserDataStatus[],
): UserActiveGuardClass {
  return new UserActiveGuardClass(blockedUserStatus, blockedUserDataStatus);
}
