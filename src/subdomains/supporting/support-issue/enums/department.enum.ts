import { UserRole } from 'src/shared/auth/user-role.enum';

export enum Department {
  SUPPORT = 'Support',
  COMPLIANCE = 'Compliance',
  MARKETING = 'Marketing',
  COOPERATION = 'Cooperation',
}

export const RoleDepartmentMap: Partial<Record<UserRole, Department>> = {
  [UserRole.SUPPORT]: Department.SUPPORT,
  [UserRole.COMPLIANCE]: Department.COMPLIANCE,
  [UserRole.MARKETING]: Department.MARKETING,
};

// Single source of truth for "which departments may this role view and handle":
//   undefined        -> unrestricted: every department, incl. issues with no department set (admins)
//   non-empty list   -> restricted to exactly these departments
//   empty list       -> no access
// Compliance is a superset of support (it also sees and answers support tickets).
export function getVisibleDepartments(role: UserRole): Department[] | undefined {
  switch (role) {
    case UserRole.ADMIN:
    case UserRole.SUPER_ADMIN:
      return undefined;
    case UserRole.COMPLIANCE:
      return [Department.SUPPORT, Department.COMPLIANCE];
    case UserRole.SUPPORT:
      return [Department.SUPPORT];
    case UserRole.MARKETING:
      return [Department.MARKETING];
    default:
      return [];
  }
}
