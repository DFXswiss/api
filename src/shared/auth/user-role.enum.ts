export enum UserRole {
  // user roles
  ACCOUNT = 'Account',
  USER = 'User',
  VIP = 'VIP',
  BETA = 'Beta',
  ADMIN = 'Admin',
  SUPER_ADMIN = 'SuperAdmin',
  SUPPORT = 'Support',
  COMPLIANCE = 'Compliance',
  CUSTODY = 'Custody',
  REALUNIT = 'RealUnit',
  MARKETING = 'Marketing',
  DEBUG = 'Debug',

  // service roles
  BANKING_BOT = 'BankingBot',

  // external client company roles
  KYC_CLIENT_COMPANY = 'KycClientCompany',
  CLIENT_COMPANY = 'ClientCompany',
}

// Staff roles a mail login may authenticate as. These get an elevated user token and, on staff endpoints,
// must pass an independent TOTP second factor (never a mail code to the same inbox as the magic link).
// Priority-ordered (highest privilege first) for mail-login role resolution.
export const StaffRoles = [UserRole.COMPLIANCE, UserRole.SUPPORT, UserRole.REALUNIT];

// Entry roles that mark an endpoint as elevated: reaching it requires an identified natural person
// behind the account, on top of the role itself. `RoleGuard` therefore demands staff KYC clearance
// (a non-empty `verifiedName`, see `HasStaffKycClearance`) whenever every entry role of a gate is
// listed here. Distinct from `StaffRoles` above, which is about mail-login
// role resolution — this list is about endpoint sensitivity and also covers ADMIN and DEBUG.
//
// Not listed, deliberately: BANKING_BOT and CUSTODY are non-staff entry roles and stay ungated, so a
// cleared-role holder reaching those endpoints via the `additionalRoles` hierarchy is not KYC-gated.
export const KycGatedRoles = [UserRole.ADMIN, UserRole.DEBUG, UserRole.COMPLIANCE, UserRole.SUPPORT, UserRole.REALUNIT];
