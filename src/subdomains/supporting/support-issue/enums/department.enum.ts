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

// Departments a role may view and handle. Compliance is a superset of support: it additionally sees
// and answers support tickets. Returns undefined for unrestricted access (admin / super admin).
export function getVisibleDepartments(role: UserRole): Department[] | undefined {
  const own = RoleDepartmentMap[role];
  if (!own) return undefined;
  return role === UserRole.COMPLIANCE ? [Department.SUPPORT, Department.COMPLIANCE] : [own];
}
