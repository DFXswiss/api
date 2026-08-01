import { CanActivate, ExecutionContext } from '@nestjs/common';
import { StaffKycRequiredException } from 'src/shared/auth/exceptions/staff-kyc-required.exception';
import { HasStaffKycClearance } from 'src/shared/auth/staff-kyc-clearance';
import { KycGatedRoles, UserRole } from 'src/shared/auth/user-role.enum';

// Role hierarchy: `additionalRoles[entryRole]` are the roles that also satisfy an
// `entryRole` requirement (super-roles). Single source of truth for role checks —
// the `hasRoleAccess` predicate below routes every ad-hoc `.includes()` at call
// sites through this map, so a hierarchy change here reaches every gate.
const additionalRoles: Partial<Record<UserRole, UserRole[]>> = {
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
  [UserRole.REALUNIT]: [UserRole.COMPLIANCE, UserRole.ADMIN, UserRole.SUPER_ADMIN],
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

/**
 * `hasRoleAccess` plus the staff KYC clearance that `RoleGuard` applies to elevated endpoints — for
 * the handful of places that decide staff privileges in business logic rather than through a gate.
 * Those sit on endpoints that are NOT role-gated (OptionalJwtAuthGuard / an ACCOUNT gate), so without
 * this the KYC requirement would be bypassable: an uncleared admin would lose `/admin` yet keep
 * protected KYC file downloads and ownership-independent access to any customer's history.
 *
 * Not needed where a privilege check merely refines behaviour behind an already-gated endpoint (e.g.
 * the `isAdmin` distinctions in the support note services) — the gate has run by then.
 */
export function hasStaffAccess(entryRole: UserRole, jwt: { role?: UserRole; account?: number } | undefined): boolean {
  if (!hasRoleAccess(entryRole, jwt?.role)) return false;
  if (!KycGatedRoles.includes(entryRole)) return true;
  return HasStaffKycClearance(jwt?.account);
}

/**
 * Every role that satisfies at least one of `entryRoles` — the entry roles themselves plus their
 * super-roles per `additionalRoles`. Derived from the same map as `hasRoleAccess` so that a hierarchy
 * change cannot desync the two: `StaffKycClearanceService` uses this to decide whose KYC clearance
 * to track, and would otherwise silently lock out a role newly granted access to a gated endpoint.
 */
export function rolesSatisfying(entryRoles: UserRole[]): UserRole[] {
  return [...new Set(entryRoles.flatMap((entryRole) => [entryRole, ...(additionalRoles[entryRole] ?? [])]))];
}

class RoleGuardClass implements CanActivate {
  private readonly entryRoles: UserRole[];

  constructor(...entryRoles: UserRole[]) {
    this.entryRoles = entryRoles;
  }

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!this.entryRoles.some((entryRole) => hasRoleAccess(entryRole, user?.role))) return false;

    // Elevated endpoint: an identified natural person must be behind the account (see KycGatedRoles).
    // The gate is a property of the ENDPOINT, not of the caller, so it applies only when EVERY entry
    // role is gated — a gate that also admits e.g. UserRole.USER is an ordinary endpoint that an admin
    // happens to reach through the role hierarchy, and must not start demanding staff KYC.
    //
    // Throws rather than returning false: a bare false becomes the generic "Forbidden resource", which
    // a caller cannot tell apart from a removed role, so neither staff nor tooling would learn that the
    // fix is to complete an identification. `JwtUserActiveGuard` calls this guard programmatically, but
    // only with UserRole.USER, which is never elevated — so it still gets a boolean.
    if (this.isElevated && !HasStaffKycClearance(user?.account)) throw new StaffKycRequiredException();

    return true;
  }

  // No empty-list guard needed: `canActivate` has already returned false by then, since no role can
  // satisfy an empty entry-role list.
  private get isElevated(): boolean {
    return this.entryRoles.every((entryRole) => KycGatedRoles.includes(entryRole));
  }
}

// Accepts one or more entry roles; access is granted when the caller satisfies ANY of them (each
// via the `additionalRoles` hierarchy in `hasRoleAccess`). A single role keeps the prior behavior;
// pass multiple independent roles to OR them (e.g. `RoleGuard(UserRole.COMPLIANCE, UserRole.DEBUG)`).
export function RoleGuard(...entryRoles: UserRole[]): RoleGuardClass {
  return new RoleGuardClass(...entryRoles);
}
