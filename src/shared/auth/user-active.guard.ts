import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';

@Injectable()
export class UserActiveGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userStatus = req.user.userStatus;
    const accountStatus = req.user.accountStatus;

    return (
      ![UserStatus.BLOCKED, UserStatus.DELETED].includes(userStatus) &&
      ![UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED].includes(accountStatus)
    );
  }
}
