import { CanActivate, ExecutionContext } from '@nestjs/common';
import { RiskStatus, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';

const DEFAULT_BLOCKED_USER_STATUS: UserStatus[] = [UserStatus.BLOCKED, UserStatus.DELETED];
const DEFAULT_BLOCKED_ACCOUNT_STATUS: UserDataStatus[] = [UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED];
const DEFAULT_BLOCKED_RISK_STATUS: RiskStatus[] = [RiskStatus.BLOCKED, RiskStatus.SUSPICIOUS];

export function isUserActive(
  user: { userStatus?: UserStatus; accountStatus?: UserDataStatus; riskStatus?: RiskStatus },
  blockedUserStatus: UserStatus[] = [],
  blockedUserDataStatus: UserDataStatus[] = [],
  blockedUserDataRiskStatus: RiskStatus[] = [],
): boolean {
  const { userStatus, accountStatus, riskStatus } = user;

  // An empty argument list falls back to the default block lists — if any dimension is
  // customised, all three custom lists are used together (same "custom OR default" branch
  // semantics as before, but evaluated once instead of duplicating the predicate).
  const hasCustom = !!(blockedUserStatus.length || blockedUserDataStatus.length || blockedUserDataRiskStatus.length);
  const blockedUsers = hasCustom ? blockedUserStatus : DEFAULT_BLOCKED_USER_STATUS;
  const blockedAccounts = hasCustom ? blockedUserDataStatus : DEFAULT_BLOCKED_ACCOUNT_STATUS;
  const blockedRisks = hasCustom ? blockedUserDataRiskStatus : DEFAULT_BLOCKED_RISK_STATUS;

  return (
    !blockedUsers.includes(userStatus) &&
    !blockedAccounts.includes(accountStatus) &&
    (!riskStatus || !blockedRisks.includes(riskStatus))
  );
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
