import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CustodyAccessLevel, CustodyAccountStatus } from '../../enums/custody';
import { CustodyAccountAccess } from '../custody-account-access.entity';
import { CustodyAccount } from '../custody-account.entity';

describe('CustodyAccount', () => {
  const ownerId = 100;
  const granteeId = 200;
  const strangerId = 300;
  const custodyAccountId = 1;

  function userData(overrides: Partial<UserData> = {}): UserData {
    return Object.assign(new UserData(), { id: ownerId, users: [], custodyAccounts: [], ...overrides });
  }

  function custodyAccount(overrides: Partial<CustodyAccount> = {}): CustodyAccount {
    return Object.assign(new CustodyAccount(), {
      id: custodyAccountId,
      title: 'Own Safe',
      description: 'Owner account',
      owner: userData(),
      requiredSignatures: 1,
      status: CustodyAccountStatus.ACTIVE,
      accessGrants: [],
      ...overrides,
    });
  }

  function accessGrant(params: {
    id?: number;
    account: CustodyAccount;
    userData: UserData;
    accessLevel: CustodyAccessLevel;
    active: boolean;
  }): CustodyAccountAccess {
    return Object.assign(new CustodyAccountAccess(), {
      id: params.id ?? 10,
      account: params.account,
      userData: params.userData,
      accessLevel: params.accessLevel,
      active: params.active,
    });
  }

  describe('#isOwnedBy(...)', () => {
    it("returns true for the owner's user-data id", () => {
      const account = custodyAccount();

      expect(account.isOwnedBy(ownerId)).toBe(true);
    });

    it('returns false for a grantee with an active write grant on the account', () => {
      const account = custodyAccount();
      const grant = accessGrant({
        account,
        userData: userData({ id: granteeId }),
        accessLevel: CustodyAccessLevel.WRITE,
        active: true,
      });
      account.accessGrants = [grant];

      expect(account.isOwnedBy(granteeId)).toBe(false);
    });

    it('returns false for a user-data id with no ownership or access grant', () => {
      const account = custodyAccount();
      const grant = accessGrant({
        account,
        userData: userData({ id: granteeId }),
        accessLevel: CustodyAccessLevel.WRITE,
        active: true,
      });
      account.accessGrants = [grant];

      expect(account.isOwnedBy(strangerId)).toBe(false);
    });
  });
});
