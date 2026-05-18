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
