import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';

@Injectable()
export class UserGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userStatus = req.user.userStatus;
    const userDataStatus = req.user.userDataStatus;

    return (
      userStatus !== UserStatus.BLOCKED &&
      userStatus !== UserStatus.DELETED &&
      userDataStatus !== UserDataStatus.BLOCKED &&
      userDataStatus !== UserDataStatus.DEACTIVATED
    );
  }
}
