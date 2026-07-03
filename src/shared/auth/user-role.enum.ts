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
