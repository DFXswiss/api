import { CanActivate, ExecutionContext } from '@nestjs/common';
import { RiskStatus, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';

export function isUserActive(
  user: { userStatus?: UserStatus; accountStatus?: UserDataStatus; riskStatus?: RiskStatus },
  blockedUserStatus: UserStatus[] = [],
  blockedUserDataStatus: UserDataStatus[] = [],
  blockedUserDataRiskStatus: RiskStatus[] = [],
): boolean {
  const userStatus = user.userStatus;
  const accountStatus = user.accountStatus;
  const riskStatus = user.riskStatus;

  return blockedUserDataStatus.length || blockedUserStatus.length || blockedUserDataRiskStatus.length
    ? !blockedUserStatus.includes(userStatus) &&
        !blockedUserDataStatus.includes(accountStatus) &&
        (!riskStatus || !blockedUserDataRiskStatus.includes(riskStatus))
    : ![UserStatus.BLOCKED, UserStatus.DELETED].includes(userStatus) &&
        ![UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED].includes(accountStatus) &&
        (!riskStatus || ![RiskStatus.BLOCKED, RiskStatus.SUSPICIOUS].includes(riskStatus));
}

class UserActiveGuardClass implements CanActivate {
  constructor(
    private readonly blockedUserStatus: UserStatus[] = [],
    private readonly blockedUserDataStatus: UserDataStatus[] = [],
    private readonly blockedUserDataRiskStatus: RiskStatus[] = [],
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    return isUserActive(req.user, this.blockedUserStatus, this.blockedUserDataStatus, this.blockedUserDataRiskStatus);
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
