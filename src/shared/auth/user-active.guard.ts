import { CanActivate, ExecutionContext } from '@nestjs/common';
import { RiskStatus, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';

class UserActiveGuardClass implements CanActivate {
  constructor(
    private readonly blockedUserStatus: UserStatus[] = [],
    private readonly blockedUserDataStatus: UserDataStatus[] = [],
    private readonly blockedUserDataRiskStatus: RiskStatus[] = [],
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userStatus = req.user.userStatus;
    const accountStatus = req.user.accountStatus;
    const riskStatus = req.user.riskStatus;

    return this.blockedUserDataStatus.length || this.blockedUserStatus.length || this.blockedUserDataRiskStatus.length
      ? !this.blockedUserStatus.includes(userStatus) &&
          !this.blockedUserDataStatus.includes(accountStatus) &&
          (!riskStatus || !this.blockedUserDataRiskStatus.includes(riskStatus))
      : ![UserStatus.BLOCKED, UserStatus.DELETED].includes(userStatus) &&
          ![UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED].includes(accountStatus) &&
          (!riskStatus || ![RiskStatus.BLOCKED, RiskStatus.SUSPICIOUS].includes(riskStatus));
  }
}

export function UserActiveGuard(
  blockedUserStatus: UserStatus[] = [],
  blockedUserDataStatus: UserDataStatus[] = [],
  blockedUserDataRiskStatus: RiskStatus[] = [],
): UserActiveGuardClass {
  return new UserActiveGuardClass(blockedUserStatus, blockedUserDataStatus, blockedUserDataRiskStatus);
}

export function BuyActiveGuard(): UserActiveGuardClass {
  return new UserActiveGuardClass(
    [UserStatus.BLOCKED, UserStatus.DELETED],
    [UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED],
    [RiskStatus.BLOCKED, RiskStatus.SUSPICIOUS, RiskStatus.BLOCKED_BUY_CRYPTO],
  );
}

export function SwapActiveGuard(): UserActiveGuardClass {
  return new UserActiveGuardClass(
    [UserStatus.BLOCKED, UserStatus.DELETED],
    [UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED],
    [RiskStatus.BLOCKED, RiskStatus.SUSPICIOUS, RiskStatus.BLOCKED_BUY_CRYPTO],
  );
}

export function SellActiveGuard(): UserActiveGuardClass {
  return new UserActiveGuardClass(
    [UserStatus.BLOCKED, UserStatus.DELETED],
    [UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED],
    [RiskStatus.BLOCKED, RiskStatus.SUSPICIOUS, RiskStatus.BLOCKED_BUY_FIAT],
  );
}
