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

// Roles with admin privileges: super admin is a strict superset of admin, so both are treated as admin.
export const ADMIN_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];
