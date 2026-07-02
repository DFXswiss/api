import { hasRoleAccess } from '../role.guard';
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

  it('returns false for a missing userRole (undefined)', () => {
    expect(hasRoleAccess(UserRole.ADMIN, undefined)).toBe(false);
    expect(hasRoleAccess(UserRole.SUPPORT, undefined)).toBe(false);
  });
});
