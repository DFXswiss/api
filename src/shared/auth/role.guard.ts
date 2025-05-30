import { CanActivate, ExecutionContext } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';

class RoleGuardClass implements CanActivate {
  // additional allowed roles
  private readonly additionalRoles = {
    [UserRole.ACCOUNT]: [UserRole.USER, UserRole.CUSTODY, UserRole.VIP, UserRole.BETA, UserRole.ADMIN],
    [UserRole.USER]: [UserRole.VIP, UserRole.BETA, UserRole.ADMIN, UserRole.CUSTODY],
    [UserRole.VIP]: [UserRole.ADMIN],
    [UserRole.BETA]: [UserRole.ADMIN],
    [UserRole.SUPPORT]: [UserRole.COMPLIANCE, UserRole.ADMIN],
    [UserRole.COMPLIANCE]: [UserRole.ADMIN],
    [UserRole.BANKING_BOT]: [UserRole.ADMIN],
  };

  constructor(private readonly entryRole: UserRole) {}

  canActivate(context: ExecutionContext): boolean {
    const userRole = context.switchToHttp().getRequest().user.role;
    return this.entryRole === userRole || this.additionalRoles[this.entryRole]?.includes(userRole);
  }
}

export function RoleGuard(entryRole: UserRole): RoleGuardClass {
  return new RoleGuardClass(entryRole);
}
