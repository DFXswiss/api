import { CanActivate, ExecutionContext } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';

// Role hierarchy: `additionalRoles[entryRole]` are the roles that also satisfy an
// `entryRole` requirement (super-roles). Single source of truth for role checks —
// the `hasRoleAccess` predicate below routes every ad-hoc `.includes()` at call
// sites through this map, so a hierarchy change here reaches every gate.
const additionalRoles: Record<string, UserRole[]> = {
  [UserRole.ACCOUNT]: [
    UserRole.USER,
    UserRole.CUSTODY,
    UserRole.VIP,
    UserRole.BETA,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.SUPPORT,
    UserRole.COMPLIANCE,
    UserRole.MARKETING,
    UserRole.REALUNIT,
  ],
  [UserRole.USER]: [
    UserRole.VIP,
    UserRole.BETA,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.CUSTODY,
    UserRole.SUPPORT,
    UserRole.COMPLIANCE,
    UserRole.MARKETING,
    UserRole.REALUNIT,
  ],
  [UserRole.VIP]: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
  [UserRole.BETA]: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
  [UserRole.SUPPORT]: [UserRole.COMPLIANCE, UserRole.ADMIN, UserRole.SUPER_ADMIN],
  [UserRole.MARKETING]: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
  [UserRole.COMPLIANCE]: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
  [UserRole.BANKING_BOT]: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
  [UserRole.REALUNIT]: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
  [UserRole.ADMIN]: [UserRole.SUPER_ADMIN],
  [UserRole.DEBUG]: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
  [UserRole.CLIENT_COMPANY]: [UserRole.KYC_CLIENT_COMPANY],
};

/**
 * Whether `userRole` satisfies a requirement for `entryRole` — i.e. is
 * `entryRole` itself or one of its super-roles per `additionalRoles`. Use this
 * everywhere in call sites (e.g. `SUPPORT_STAFF_ROLES.includes(role)` becomes
 * `hasRoleAccess(UserRole.SUPPORT, role)`) so the hierarchy stays in one place.
 */
export function hasRoleAccess(entryRole: UserRole, userRole: UserRole | undefined): boolean {
  if (!userRole) return false;
  return entryRole === userRole || (additionalRoles[entryRole]?.includes(userRole) ?? false);
}

class RoleGuardClass implements CanActivate {
  constructor(private readonly entryRole: UserRole) {}

  canActivate(context: ExecutionContext): boolean {
    const userRole = context.switchToHttp().getRequest().user?.role;
    return hasRoleAccess(this.entryRole, userRole);
  }
}

export function RoleGuard(entryRole: UserRole): RoleGuardClass {
  return new RoleGuardClass(entryRole);
}
