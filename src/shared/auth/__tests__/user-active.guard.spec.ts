import { RiskStatus, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { isUserActive } from '../user-active.guard';

// The pre-refactor ternary was duplicated across default-list and custom-list branches. These pin
// both branches so that a future consolidation of `isUserActive` cannot silently diverge the guard
// path from the ad-hoc `isUserActive(jwt)` call sites (kyc.service.ts, support-issue.controller.ts).
describe('isUserActive', () => {
  describe('default lists (called with no custom args)', () => {
    it('accepts an ACTIVE user with no risk', () => {
      expect(isUserActive({ userStatus: UserStatus.ACTIVE, accountStatus: UserDataStatus.ACTIVE })).toBe(true);
    });

    it('rejects a BLOCKED user status', () => {
      expect(isUserActive({ userStatus: UserStatus.BLOCKED, accountStatus: UserDataStatus.ACTIVE })).toBe(false);
    });

    it('rejects a DELETED user status', () => {
      expect(isUserActive({ userStatus: UserStatus.DELETED, accountStatus: UserDataStatus.ACTIVE })).toBe(false);
    });

    it('rejects a BLOCKED account status', () => {
      expect(isUserActive({ userStatus: UserStatus.ACTIVE, accountStatus: UserDataStatus.BLOCKED })).toBe(false);
    });

    it('rejects a DEACTIVATED account status', () => {
      expect(isUserActive({ userStatus: UserStatus.ACTIVE, accountStatus: UserDataStatus.DEACTIVATED })).toBe(false);
    });

    it('rejects a BLOCKED risk status', () => {
      expect(
        isUserActive({
          userStatus: UserStatus.ACTIVE,
          accountStatus: UserDataStatus.ACTIVE,
          riskStatus: RiskStatus.BLOCKED,
        }),
      ).toBe(false);
    });

    it('rejects a SUSPICIOUS risk status', () => {
      expect(
        isUserActive({
          userStatus: UserStatus.ACTIVE,
          accountStatus: UserDataStatus.ACTIVE,
          riskStatus: RiskStatus.SUSPICIOUS,
        }),
      ).toBe(false);
    });

    it('accepts an undefined risk status', () => {
      expect(isUserActive({ userStatus: UserStatus.ACTIVE, accountStatus: UserDataStatus.ACTIVE })).toBe(true);
    });
  });

  describe('custom lists (any dimension customised => all three swap to custom lists)', () => {
    it('accepts a BLOCKED risk status when custom lists opt out of that check', () => {
      // Only user/account customised (risk list is []); previously the "custom" branch would
      // therefore not gate on risk. The refactor preserves this: an empty list means
      // "no values block".
      expect(
        isUserActive(
          {
            userStatus: UserStatus.ACTIVE,
            accountStatus: UserDataStatus.ACTIVE,
            riskStatus: RiskStatus.BLOCKED,
          },
          [UserStatus.DELETED],
          [UserDataStatus.DEACTIVATED],
          [],
        ),
      ).toBe(true);
    });

    it('applies the custom user-status block list', () => {
      expect(
        isUserActive({ userStatus: UserStatus.DELETED, accountStatus: UserDataStatus.ACTIVE }, [UserStatus.DELETED]),
      ).toBe(false);
    });

    it('applies the extended custom risk list (BLOCKED_BUY_CRYPTO)', () => {
      expect(
        isUserActive(
          {
            userStatus: UserStatus.ACTIVE,
            accountStatus: UserDataStatus.ACTIVE,
            riskStatus: RiskStatus.BLOCKED_BUY_CRYPTO,
          },
          [UserStatus.BLOCKED, UserStatus.DELETED],
          [UserDataStatus.BLOCKED, UserDataStatus.DEACTIVATED],
          [RiskStatus.BLOCKED, RiskStatus.SUSPICIOUS, RiskStatus.BLOCKED_BUY_CRYPTO],
        ),
      ).toBe(false);
    });

    it('accepts SUSPICIOUS when the custom risk list omits it (any list customised triggers the switch)', () => {
      // Sanity-check the "any custom list flips ALL three to custom" semantic — passing a
      // custom user list with empty risk list means SUSPICIOUS is no longer blocked.
      expect(
        isUserActive(
          {
            userStatus: UserStatus.ACTIVE,
            accountStatus: UserDataStatus.ACTIVE,
            riskStatus: RiskStatus.SUSPICIOUS,
          },
          [UserStatus.DELETED],
        ),
      ).toBe(true);
    });
  });
});
