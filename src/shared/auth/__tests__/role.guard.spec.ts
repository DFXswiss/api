import { ExecutionContext } from '@nestjs/common';
import { hasRoleAccess, RoleGuard } from '../role.guard';
import { UserRole } from '../user-role.enum';

// Pins the hierarchy checks previously encoded in ad-hoc constants
// (`ADMIN_ROLES.includes(role)`, `[UserRole.SUPPORT, UserRole.COMPLIANCE, ...ADMIN_ROLES].includes(role)`,
// `[...ADMIN_ROLES, UserRole.COMPLIANCE].includes(role)`) so that any drift between the map in
// `role.guard.ts` and its consumers surfaces here rather than at runtime.
describe('hasRoleAccess', () => {
  describe('entry role: ADMIN (replaces ADMIN_ROLES.includes)', () => {
    it.each([
      [UserRole.ADMIN, true],
      [UserRole.SUPER_ADMIN, true],
      [UserRole.SUPPORT, false],
      [UserRole.COMPLIANCE, false],
      [UserRole.USER, false],
      [UserRole.ACCOUNT, false],
      [UserRole.CUSTODY, false],
    ])('%s → %s', (role, expected) => {
      expect(hasRoleAccess(UserRole.ADMIN, role)).toBe(expected);
    });
  });

  describe('entry role: SUPPORT (replaces SUPPORT_STAFF_ROLES.includes)', () => {
    it.each([
      [UserRole.SUPPORT, true],
      [UserRole.COMPLIANCE, true],
      [UserRole.ADMIN, true],
      [UserRole.SUPER_ADMIN, true],
      [UserRole.USER, false],
      [UserRole.CUSTODY, false],
      [UserRole.MARKETING, false],
    ])('%s → %s', (role, expected) => {
      expect(hasRoleAccess(UserRole.SUPPORT, role)).toBe(expected);
    });
  });

  describe('entry role: COMPLIANCE (replaces [...ADMIN_ROLES, COMPLIANCE].includes)', () => {
    it.each([
      [UserRole.COMPLIANCE, true],
      [UserRole.ADMIN, true],
      [UserRole.SUPER_ADMIN, true],
      [UserRole.SUPPORT, false],
      [UserRole.USER, false],
    ])('%s → %s', (role, expected) => {
      expect(hasRoleAccess(UserRole.COMPLIANCE, role)).toBe(expected);
    });
  });

  describe('entry role: REALUNIT (COMPLIANCE ranks above REALUNIT)', () => {
    it.each([
      [UserRole.REALUNIT, true],
      [UserRole.COMPLIANCE, true],
      [UserRole.ADMIN, true],
      [UserRole.SUPER_ADMIN, true],
      [UserRole.SUPPORT, false],
      [UserRole.USER, false],
      [UserRole.DEBUG, false],
    ])('%s → %s', (role, expected) => {
      expect(hasRoleAccess(UserRole.REALUNIT, role)).toBe(expected);
    });

    it('is one-directional: REALUNIT does not gain COMPLIANCE/ADMIN/DEBUG gates', () => {
      expect(hasRoleAccess(UserRole.COMPLIANCE, UserRole.REALUNIT)).toBe(false);
      expect(hasRoleAccess(UserRole.ADMIN, UserRole.REALUNIT)).toBe(false);
      expect(hasRoleAccess(UserRole.DEBUG, UserRole.REALUNIT)).toBe(false);
    });
  });

  it('returns false for a missing userRole (undefined)', () => {
    expect(hasRoleAccess(UserRole.ADMIN, undefined)).toBe(false);
    expect(hasRoleAccess(UserRole.SUPPORT, undefined)).toBe(false);
  });
});

describe('RoleGuard (multi-role access)', () => {
  function contextFor(role?: UserRole): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
    } as unknown as ExecutionContext;
  }

  it('grants access to the single entry role and its super-roles, denies others', () => {
    expect(RoleGuard(UserRole.COMPLIANCE).canActivate(contextFor(UserRole.COMPLIANCE))).toBe(true);
    expect(RoleGuard(UserRole.COMPLIANCE).canActivate(contextFor(UserRole.ADMIN))).toBe(true);
    expect(RoleGuard(UserRole.COMPLIANCE).canActivate(contextFor(UserRole.DEBUG))).toBe(false);
  });

  it('grants access when the caller satisfies ANY of several entry roles (COMPLIANCE or DEBUG)', () => {
    const guard = RoleGuard(UserRole.COMPLIANCE, UserRole.DEBUG);
    expect(guard.canActivate(contextFor(UserRole.COMPLIANCE))).toBe(true);
    expect(guard.canActivate(contextFor(UserRole.DEBUG))).toBe(true);
    expect(guard.canActivate(contextFor(UserRole.ADMIN))).toBe(true); // super-role of both
  });

  it('denies a caller who satisfies none of the entry roles', () => {
    expect(RoleGuard(UserRole.COMPLIANCE, UserRole.DEBUG).canActivate(contextFor(UserRole.SUPPORT))).toBe(false);
    expect(RoleGuard(UserRole.COMPLIANCE, UserRole.DEBUG).canActivate(contextFor(undefined))).toBe(false);
  });
});
