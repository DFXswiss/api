import { ExecutionContext, HttpStatus } from '@nestjs/common';

// The clearance Set is primed by cron; mocked here so the guard's gating logic is tested in isolation
// from the cron/DB plumbing.
jest.mock('src/shared/auth/staff-kyc-clearance', () => ({
  HasStaffKycClearance: jest.fn(),
}));

import { StaffKycRequiredException } from 'src/shared/auth/exceptions/staff-kyc-required.exception';
import { HasStaffKycClearance } from 'src/shared/auth/staff-kyc-clearance';
import { hasRoleAccess, hasStaffAccess, RoleGuard, rolesSatisfying } from '../role.guard';
import { KycGatedRoles, UserRole } from '../user-role.enum';

const hasStaffKycClearanceMock = HasStaffKycClearance as jest.MockedFunction<typeof HasStaffKycClearance>;

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

  // Entry roles with no `additionalRoles` entry at all (no super-roles): only the role itself matches.
  it('matches only the role itself for an entry role without super-roles', () => {
    expect(hasRoleAccess(UserRole.SUPER_ADMIN, UserRole.SUPER_ADMIN)).toBe(true);
    expect(hasRoleAccess(UserRole.SUPER_ADMIN, UserRole.ADMIN)).toBe(false);
    expect(hasRoleAccess(UserRole.CUSTODY, UserRole.ADMIN)).toBe(false);
  });
});

// The predicate used by the few privilege checks that live in business logic instead of a gate
// (protected KYC files, ownership-independent history access, official support replies).
describe('hasStaffAccess', () => {
  afterEach(() => jest.resetAllMocks());

  it('denies a caller whose role does not satisfy the entry role, without consulting the clearance', () => {
    hasStaffKycClearanceMock.mockReturnValue(true);

    expect(hasStaffAccess(UserRole.COMPLIANCE, { role: UserRole.USER, account: 1 })).toBe(false);
    expect(hasStaffKycClearanceMock).not.toHaveBeenCalled();
  });

  it('denies an undefined jwt', () => {
    expect(hasStaffAccess(UserRole.COMPLIANCE, undefined)).toBe(false);
  });

  describe.each(KycGatedRoles)('gated entry role: %s', (entryRole) => {
    it('grants a cleared account', () => {
      hasStaffKycClearanceMock.mockReturnValue(true);

      expect(hasStaffAccess(entryRole, { role: entryRole, account: 1 })).toBe(true);
      expect(hasStaffKycClearanceMock).toHaveBeenCalledWith(1);
    });

    it('denies an uncleared account despite the correct role', () => {
      hasStaffKycClearanceMock.mockReturnValue(false);

      expect(hasStaffAccess(entryRole, { role: entryRole, account: 1 })).toBe(false);
    });
  });

  it('does not require clearance for an ungated entry role', () => {
    hasStaffKycClearanceMock.mockReturnValue(false);

    expect(hasStaffAccess(UserRole.USER, { role: UserRole.ADMIN, account: 1 })).toBe(true);
    expect(hasStaffKycClearanceMock).not.toHaveBeenCalled();
  });
});

describe('rolesSatisfying', () => {
  it('covers the gated entry roles plus their super-roles', () => {
    const roles = rolesSatisfying(KycGatedRoles);

    expect(roles).toEqual(expect.arrayContaining(KycGatedRoles));
    // SUPER_ADMIN satisfies every gate via the hierarchy without being listed in KycGatedRoles —
    // omitting it from the clearance sync would lock super admins out of every elevated endpoint.
    expect(roles).toContain(UserRole.SUPER_ADMIN);
    expect(roles).not.toContain(UserRole.USER);
    expect(roles).not.toContain(UserRole.ACCOUNT);
  });

  it('deduplicates roles reachable through several entry roles', () => {
    expect(rolesSatisfying(KycGatedRoles)).toHaveLength(new Set(rolesSatisfying(KycGatedRoles)).size);
  });

  it('returns just the entry role when it has no super-roles', () => {
    expect(rolesSatisfying([UserRole.SUPER_ADMIN])).toEqual([UserRole.SUPER_ADMIN]);
  });

  it('returns an empty list for no entry roles', () => {
    expect(rolesSatisfying([])).toEqual([]);
  });
});

describe('RoleGuard (multi-role access)', () => {
  function contextFor(role?: UserRole, account = 1): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { role, account } : undefined }) }),
    } as unknown as ExecutionContext;
  }

  // Default to a cleared account so the pre-existing role-hierarchy expectations below keep testing
  // the hierarchy, not the KYC gate; the gate gets its own describe block.
  beforeEach(() => hasStaffKycClearanceMock.mockReturnValue(true));
  afterEach(() => jest.resetAllMocks());

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

describe('RoleGuard (staff KYC gate on elevated endpoints)', () => {
  function contextFor(role?: UserRole, account?: number): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { role, account } : undefined }) }),
    } as unknown as ExecutionContext;
  }

  afterEach(() => jest.resetAllMocks());

  describe.each(KycGatedRoles)('entry role: %s', (entryRole) => {
    it('denies the matching role when the account has no KYC clearance', () => {
      hasStaffKycClearanceMock.mockReturnValue(false);

      // Throws rather than returning false, so the caller learns the reason instead of a bare 403.
      expect(() => RoleGuard(entryRole).canActivate(contextFor(entryRole, 42))).toThrow(StaffKycRequiredException);
    });

    it('grants the matching role when the account is cleared', () => {
      hasStaffKycClearanceMock.mockReturnValue(true);

      expect(RoleGuard(entryRole).canActivate(contextFor(entryRole, 42))).toBe(true);
      expect(hasStaffKycClearanceMock).toHaveBeenCalledWith(42);
    });
  });

  it('gates super-roles too — an uncleared ADMIN loses every elevated endpoint', () => {
    hasStaffKycClearanceMock.mockReturnValue(false);

    expect(() => RoleGuard(UserRole.SUPPORT).canActivate(contextFor(UserRole.ADMIN, 42))).toThrow(
      StaffKycRequiredException,
    );
    expect(() =>
      RoleGuard(UserRole.COMPLIANCE, UserRole.DEBUG).canActivate(contextFor(UserRole.SUPER_ADMIN, 42)),
    ).toThrow(StaffKycRequiredException);
  });

  it('does not gate ordinary endpoints, even for a staff caller without clearance', () => {
    hasStaffKycClearanceMock.mockReturnValue(false);

    // An admin using ordinary customer functionality is not touching an elevated endpoint.
    expect(RoleGuard(UserRole.USER).canActivate(contextFor(UserRole.ADMIN, 42))).toBe(true);
    expect(RoleGuard(UserRole.ACCOUNT).canActivate(contextFor(UserRole.ADMIN, 42))).toBe(true);
    expect(hasStaffKycClearanceMock).not.toHaveBeenCalled();
  });

  it('treats a gate that also admits an ungated entry role as an ordinary endpoint', () => {
    hasStaffKycClearanceMock.mockReturnValue(false);

    // The gate is a property of the endpoint: one that is open to plain users is not elevated,
    // regardless of which entry role the caller happens to come in through.
    expect(RoleGuard(UserRole.ADMIN, UserRole.USER).canActivate(contextFor(UserRole.ADMIN, 42))).toBe(true);
  });

  it('denies an elevated endpoint when the token carries no account id', () => {
    // Company tokens (and any future addressless token) have no `account` — fail closed rather than
    // letting `undefined` slip through the clearance lookup.
    hasStaffKycClearanceMock.mockImplementation((account) => account != null);

    expect(() => RoleGuard(UserRole.ADMIN).canActivate(contextFor(UserRole.ADMIN, undefined))).toThrow(
      StaffKycRequiredException,
    );
  });

  // The point of throwing: a client — a person, a script, or an agent — must be able to tell this apart
  // from a removed role without matching on prose.
  it('answers 403 with a machine-readable code and an actionable message', () => {
    hasStaffKycClearanceMock.mockReturnValue(false);

    let thrown: StaffKycRequiredException;
    try {
      RoleGuard(UserRole.ADMIN).canActivate(contextFor(UserRole.ADMIN, 42));
    } catch (e) {
      thrown = e as StaffKycRequiredException;
    }

    expect(thrown.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(thrown.getResponse()).toEqual({
      code: 'STAFF_KYC_REQUIRED',
      message: expect.stringContaining('verified name'),
    });
  });

  // A wrong role is a different situation with a different fix, so it must not produce the KYC answer.
  it('still returns a plain false when the role itself does not satisfy the gate', () => {
    hasStaffKycClearanceMock.mockReturnValue(false);

    expect(RoleGuard(UserRole.ADMIN).canActivate(contextFor(UserRole.USER, 42))).toBe(false);
    expect(hasStaffKycClearanceMock).not.toHaveBeenCalled();
  });
});
