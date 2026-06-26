import { UserRole } from 'src/shared/auth/user-role.enum';
import { Department, getVisibleDepartments } from '../department.enum';

describe('getVisibleDepartments', () => {
  it('limits support to the support department', () => {
    expect(getVisibleDepartments(UserRole.SUPPORT)).toEqual([Department.SUPPORT]);
  });

  it('lets compliance see and handle support tickets as well (superset of support)', () => {
    expect(getVisibleDepartments(UserRole.COMPLIANCE)).toEqual([Department.SUPPORT, Department.COMPLIANCE]);
  });

  it('limits marketing to the marketing department', () => {
    expect(getVisibleDepartments(UserRole.MARKETING)).toEqual([Department.MARKETING]);
  });

  it('returns undefined (unrestricted) for admin and super admin', () => {
    expect(getVisibleDepartments(UserRole.ADMIN)).toBeUndefined();
    expect(getVisibleDepartments(UserRole.SUPER_ADMIN)).toBeUndefined();
  });
});
