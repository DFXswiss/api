import { UserRole } from 'src/shared/auth/user-role.enum';
import { createCustomUser } from '../user/__mocks__/user.entity.mock';
import { User } from '../user/user.entity';
import { UserStatus } from '../user/user.enum';
import { createCustomUserData } from './__mocks__/user-data.entity.mock';

describe('UserData', () => {
  // getMailLoginUser resolves which user a mail login authenticates as for an elevated role. It is the
  // security-critical core of the mail-login staff-role feature (see AuthService.completeSignInByMail).
  describe('getMailLoginUser', () => {
    // priority-ordered staff whitelist, mirrors MailLoginStaffRoles in auth.service.ts
    const STAFF_ROLES = [UserRole.COMPLIANCE, UserRole.SUPPORT, UserRole.REALUNIT];

    const user = (role: UserRole, overrides: Partial<User> = {}): User => createCustomUser({ role, ...overrides });
    const resolve = (users?: User[]): User | undefined => createCustomUserData({ users }).getMailLoginUser(STAFF_ROLES);

    it('returns undefined for a regular account (only USER wallets)', () => {
      expect(resolve([user(UserRole.USER, { id: 1 }), user(UserRole.USER, { id: 2 })])).toBeUndefined();
    });

    it('returns the staff user for a support account', () => {
      const support = user(UserRole.SUPPORT, { id: 7 });
      expect(resolve([user(UserRole.USER, { id: 1 }), support])).toBe(support);
    });

    it('elevates a realunit account', () => {
      const realunit = user(UserRole.REALUNIT, { id: 5 });
      expect(resolve([realunit])).toBe(realunit);
    });

    it('prefers the higher-privileged role: COMPLIANCE over SUPPORT', () => {
      const compliance = user(UserRole.COMPLIANCE, { id: 2 });
      const support = user(UserRole.SUPPORT, { id: 3 });
      expect(resolve([support, compliance])).toBe(compliance);
    });

    it('prefers the higher-privileged role: SUPPORT over REALUNIT', () => {
      const support = user(UserRole.SUPPORT, { id: 3 });
      const realunit = user(UserRole.REALUNIT, { id: 4 });
      expect(resolve([realunit, support])).toBe(support);
    });

    it('never elevates a role outside the whitelist (ADMIN/SUPER_ADMIN/MARKETING)', () => {
      const users = [
        user(UserRole.ADMIN, { id: 1 }),
        user(UserRole.SUPER_ADMIN, { id: 2 }),
        user(UserRole.MARKETING, { id: 3 }),
      ];
      expect(resolve(users)).toBeUndefined();
    });

    it('skips a blocked staff user', () => {
      expect(resolve([user(UserRole.SUPPORT, { id: 3, status: UserStatus.BLOCKED })])).toBeUndefined();
    });

    it('skips a blocked staff user but elevates an active one', () => {
      const compliance = user(UserRole.COMPLIANCE, { id: 9 });
      const blockedSupport = user(UserRole.SUPPORT, { id: 3, status: UserStatus.BLOCKED });
      expect(resolve([blockedSupport, compliance])).toBe(compliance);
    });

    it('skips a staff user without a wallet (token generation would dereference user.wallet)', () => {
      expect(resolve([user(UserRole.SUPPORT, { id: 3, wallet: undefined })])).toBeUndefined();
    });

    it('returns undefined for an empty users list', () => {
      expect(resolve([])).toBeUndefined();
    });

    it('returns undefined when the users relation is not loaded', () => {
      expect(resolve(undefined)).toBeUndefined();
    });
  });
});
