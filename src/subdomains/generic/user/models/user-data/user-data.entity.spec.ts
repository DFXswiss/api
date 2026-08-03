import { UserRole } from 'src/shared/auth/user-role.enum';
import { createCustomUser } from '../user/__mocks__/user.entity.mock';
import { User } from '../user/user.entity';
import { UserStatus } from '../user/user.enum';
import { createCustomUserData } from './__mocks__/user-data.entity.mock';
import { UserData } from './user-data.entity';
import { ServiceProvider, UserDataStatus } from './user-data.enum';

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

    it('skips a deleted staff user', () => {
      expect(resolve([user(UserRole.SUPPORT, { id: 3, status: UserStatus.DELETED })])).toBeUndefined();
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

  // isStaff drives the TOTP-only 2FA enforcement: any account carrying a staff role must use an app factor
  // (see TfaService.setup/checkVerification). It uses hasRole, so — unlike getMailLoginUser — it does not
  // filter blocked users: an account that holds a staff role stays fail-closed onto TOTP.
  describe('isStaff', () => {
    const isStaff = (users?: User[]): boolean => createCustomUserData({ users }).isStaff;

    it('is true for a support account', () => {
      expect(isStaff([createCustomUser({ role: UserRole.USER }), createCustomUser({ role: UserRole.SUPPORT })])).toBe(
        true,
      );
    });

    it('is true for a compliance account', () => {
      expect(isStaff([createCustomUser({ role: UserRole.COMPLIANCE })])).toBe(true);
    });

    it('is true for a realunit account', () => {
      expect(isStaff([createCustomUser({ role: UserRole.REALUNIT })])).toBe(true);
    });

    it('is false for a regular account', () => {
      expect(isStaff([createCustomUser({ role: UserRole.USER })])).toBe(false);
    });

    it('is false for an admin/marketing account (not a staff role)', () => {
      expect(
        isStaff([createCustomUser({ role: UserRole.ADMIN }), createCustomUser({ role: UserRole.MARKETING })]),
      ).toBe(false);
    });

    it('is fail-closed: true even for a blocked staff user', () => {
      expect(isStaff([createCustomUser({ role: UserRole.SUPPORT, status: UserStatus.BLOCKED })])).toBe(true);
    });

    it('is false when the users relation is not loaded', () => {
      expect(isStaff(undefined)).toBe(false);
    });
  });

  // serviceProviders is the additive RealUnit customer marker ("add-on on top" of the DFX core). It must
  // never influence DFX core logic; only the RealUnit dashboards read it. These tests pin the additive,
  // idempotent, merge-safe semantics the scope service and the merge union rely on.
  describe('serviceProviders (RealUnit customer add-on)', () => {
    const userData = (serviceProviders?: string): UserData => createCustomUserData({ serviceProviders });

    it('serviceProviderList is empty when unset', () => {
      expect(userData(undefined).serviceProviderList).toEqual([]);
    });

    it('isRealUnitCustomer is false for a plain DFX account', () => {
      expect(userData(undefined).isRealUnitCustomer).toBe(false);
    });

    it('isRealUnitCustomer is true when the RealUnit marker is present', () => {
      expect(userData('RealUnit').isRealUnitCustomer).toBe(true);
    });

    it('isRealUnitCustomer is false for a merged tombstone even when the marker is present', () => {
      const ud = createCustomUserData({ serviceProviders: 'RealUnit', status: UserDataStatus.MERGED });
      expect(ud.isRealUnitCustomer).toBe(false);
    });

    it('addServiceProvider sets the marker on an account that had none', () => {
      const ud = userData(undefined);
      ud.addServiceProvider(ServiceProvider.REALUNIT);
      expect(ud.serviceProviders).toBe('RealUnit');
      expect(ud.isRealUnitCustomer).toBe(true);
    });

    it('addServiceProvider is idempotent — no duplicate token', () => {
      const ud = userData('RealUnit');
      ud.addServiceProvider(ServiceProvider.REALUNIT);
      expect(ud.serviceProviders).toBe('RealUnit');
    });

    it('addServiceProvider returns an UpdateResult tuple [id, update]', () => {
      const ud = createCustomUserData({ id: 42, serviceProviders: undefined });
      const [id, update] = ud.addServiceProvider(ServiceProvider.REALUNIT);
      expect(id).toBe(42);
      expect(update).toEqual({ serviceProviders: 'RealUnit' });
    });
  });

  // individualFees is a semicolon-separated id list. It carries money: every id in it adds its fee
  // to the customer's next transaction, and two flat fees are charged as their sum.
  describe('individual fees', () => {
    const accountWith = (feeIds: number[]): UserData => createCustomUserData({ individualFees: feeIds.join(';') });

    describe('individualFeeList', () => {
      it('reports no fees for an account whose list was emptied', () => {
        // An emptied list is stored as '', which naive splitting turns into the fee id 0.
        expect(accountWith([]).individualFeeList).toBeUndefined();
      });

      it('reports the assigned fees', () => {
        expect(accountWith([55, 70]).individualFeeList).toEqual([55, 70]);
      });
    });

    describe('replaceFee', () => {
      it('swaps the named fees for the new one', () => {
        const userData = accountWith([60]);

        const [, update] = userData.replaceFee([60], 70);

        expect(update.individualFees).toBe('70');
        expect(userData.individualFeeList).toEqual([70]);
      });

      it('keeps fees that are not part of the replaced set', () => {
        const userData = accountWith([55, 60, 92]);

        userData.replaceFee([60], 70);

        // 55 and 92 were assigned by other flows (sign-up fees, discount codes) and must survive.
        expect(userData.individualFeeList).toEqual([55, 92, 70]);
      });

      it('drops the named fees when no replacement is given', () => {
        expect(accountWith([55, 60]).replaceFee([60])[1].individualFees).toBe('55');
      });

      it('assigns a fee to an account that has none', () => {
        expect(accountWith([]).replaceFee([], 70)[1].individualFees).toBe('70');
      });

      it('leaves no fees behind when everything is replaced by nothing', () => {
        expect(accountWith([60]).replaceFee([60])[1].individualFees).toBe('');
      });

      // Two operators setting an amount at the same time load their own copy of the account.
      // Whatever the interleaving, the account must never end up carrying two flat fees.
      it.each([
        ['first write wins the read, second overwrites', [0, 1]],
        ['second write lands first', [1, 0]],
      ])('never leaves two flat fees behind when writes interleave (%s)', (_name, order) => {
        const stored = { individualFees: '60' };
        const copies = [accountWith([60]), accountWith([60])];
        const writes = [
          () => (stored.individualFees = copies[0].replaceFee([60], 70)[1].individualFees),
          () => (stored.individualFees = copies[1].replaceFee([60], 130)[1].individualFees),
        ];

        order.forEach((i) => writes[i]());

        expect(stored.individualFees.split(';').filter(Boolean)).toHaveLength(1);
        expect(['70', '130']).toContain(stored.individualFees);
      });
    });
  });
});
