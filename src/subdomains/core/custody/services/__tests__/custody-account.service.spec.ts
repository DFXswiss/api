import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ForbiddenException } from '@nestjs/common';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { FindOneOptions, FindManyOptions } from 'typeorm';
import { CustodyAccountAccess } from '../../entities/custody-account-access.entity';
import { CustodyAccount } from '../../entities/custody-account.entity';
import { CustodyAccessLevel, CustodyAccountStatus } from '../../enums/custody';
import { CustodyAccountAccessRepository } from '../../repositories/custody-account-access.repository';
import { CustodyAccountRepository } from '../../repositories/custody-account.repository';
import { CustodyAccountService } from '../custody-account.service';

describe('CustodyAccountService', () => {
  let service: CustodyAccountService;
  let custodyAccountRepo: DeepMocked<CustodyAccountRepository>;
  let custodyAccountAccessRepo: DeepMocked<CustodyAccountAccessRepository>;
  let userDataService: DeepMocked<UserDataService>;

  const ownerId = 100;
  const strangerId = 200;
  const ownAccountId = 1;
  const foreignAccountId = 2;

  function ownerUserData(overrides: Partial<UserData> = {}): UserData {
    return Object.assign(new UserData(), { id: ownerId, users: [], custodyAccounts: [], ...overrides });
  }

  function strangerUserData(overrides: Partial<UserData> = {}): UserData {
    return Object.assign(new UserData(), { id: strangerId, users: [], custodyAccounts: [], ...overrides });
  }

  function ownCustodyAccount(overrides: Partial<CustodyAccount> = {}): CustodyAccount {
    return Object.assign(new CustodyAccount(), {
      id: ownAccountId,
      title: 'Own Safe',
      description: 'Owner account',
      owner: ownerUserData(),
      requiredSignatures: 1,
      status: CustodyAccountStatus.ACTIVE,
      accessGrants: [],
      ...overrides,
    });
  }

  function foreignCustodyAccount(overrides: Partial<CustodyAccount> = {}): CustodyAccount {
    return Object.assign(new CustodyAccount(), {
      id: foreignAccountId,
      title: 'Foreign Safe',
      description: 'Shared account',
      owner: strangerUserData(),
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

  /**
   * Mirrors the repository where clause for checkAccess:
   * `{ account: { id }, userData: { id }, active: true }`.
   * Inactive grants resolve to undefined, matching Postgres behaviour.
   */
  function mockFindOneActiveGrant(grant: CustodyAccountAccess | undefined): void {
    custodyAccountAccessRepo.findOne.mockImplementation(
      async (options: FindOneOptions<CustodyAccountAccess>): Promise<CustodyAccountAccess | null> => {
        const where = options.where as {
          account?: { id?: number };
          userData?: { id?: number };
          active?: boolean;
        };

        if (!grant) {
          return null;
        }

        if (where.active === true && !grant.active) {
          return null;
        }

        if (where.account?.id !== undefined && grant.account.id !== where.account.id) {
          return null;
        }

        if (where.userData?.id !== undefined && grant.userData.id !== where.userData.id) {
          return null;
        }

        return grant;
      },
    );
  }

  /**
   * Mirrors the repository where clause for getCustodyAccountsForUser:
   * `{ userData: { id }, active: true, account: { status: ACTIVE } }`.
   * Only grants that would pass the SQL filter are returned.
   */
  function mockFindActiveGrants(grants: CustodyAccountAccess[]): void {
    custodyAccountAccessRepo.find.mockImplementation(
      async (options: FindManyOptions<CustodyAccountAccess>): Promise<CustodyAccountAccess[]> => {
        const where = options.where as {
          userData?: { id?: number };
          active?: boolean;
          account?: { status?: CustodyAccountStatus };
        };

        return grants.filter((grant) => {
          if (where.active === true && !grant.active) {
            return false;
          }
          if (where.userData?.id !== undefined && grant.userData.id !== where.userData.id) {
            return false;
          }
          if (where.account?.status !== undefined && grant.account.status !== where.account.status) {
            return false;
          }
          return true;
        });
      },
    );
  }

  beforeEach(() => {
    custodyAccountRepo = createMock<CustodyAccountRepository>();
    custodyAccountAccessRepo = createMock<CustodyAccountAccessRepository>();
    userDataService = createMock<UserDataService>();

    service = new CustodyAccountService(custodyAccountRepo, custodyAccountAccessRepo, userDataService);
  });

  describe('checkAccess', () => {
    it('allows the owner to write when there is no grant on their own account', async () => {
      const account = ownCustodyAccount();
      custodyAccountRepo.findOne.mockResolvedValue(account);
      mockFindOneActiveGrant(undefined);

      await expect(service.checkAccess(ownAccountId, ownerId, CustodyAccessLevel.WRITE)).resolves.toEqual({
        custodyAccount: account,
        isLegacy: false,
      });
    });

    it('rejects write when the owner has an active read grant on their own account', async () => {
      const account = ownCustodyAccount();
      const grant = accessGrant({
        account,
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      custodyAccountRepo.findOne.mockResolvedValue(account);
      mockFindOneActiveGrant(grant);

      await expect(service.checkAccess(ownAccountId, ownerId, CustodyAccessLevel.WRITE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows read when the owner has an active read grant on their own account', async () => {
      const account = ownCustodyAccount();
      const grant = accessGrant({
        account,
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      custodyAccountRepo.findOne.mockResolvedValue(account);
      mockFindOneActiveGrant(grant);

      await expect(service.checkAccess(ownAccountId, ownerId, CustodyAccessLevel.READ)).resolves.toEqual({
        custodyAccount: account,
        isLegacy: false,
      });
    });

    it('allows write when the owner has an active write grant on their own account', async () => {
      const account = ownCustodyAccount();
      const grant = accessGrant({
        account,
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.WRITE,
        active: true,
      });
      custodyAccountRepo.findOne.mockResolvedValue(account);
      mockFindOneActiveGrant(grant);

      await expect(service.checkAccess(ownAccountId, ownerId, CustodyAccessLevel.WRITE)).resolves.toEqual({
        custodyAccount: account,
        isLegacy: false,
      });
    });

    it('rejects access when a stranger has no grant', async () => {
      const account = ownCustodyAccount();
      custodyAccountRepo.findOne.mockResolvedValue(account);
      mockFindOneActiveGrant(undefined);

      await expect(service.checkAccess(ownAccountId, strangerId, CustodyAccessLevel.READ)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows read but rejects write when a stranger has a read grant', async () => {
      const account = ownCustodyAccount();
      const grant = accessGrant({
        account,
        userData: strangerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      custodyAccountRepo.findOne.mockResolvedValue(account);
      mockFindOneActiveGrant(grant);

      await expect(service.checkAccess(ownAccountId, strangerId, CustodyAccessLevel.READ)).resolves.toEqual({
        custodyAccount: account,
        isLegacy: false,
      });

      await expect(service.checkAccess(ownAccountId, strangerId, CustodyAccessLevel.WRITE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('does not narrow the owner when their grant on the own account is inactive', async () => {
      const account = ownCustodyAccount();
      const inactiveGrant = accessGrant({
        account,
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: false,
      });
      custodyAccountRepo.findOne.mockResolvedValue(account);
      // Mock honours active: true — inactive grant must resolve as no grant
      mockFindOneActiveGrant(inactiveGrant);

      await expect(service.checkAccess(ownAccountId, ownerId, CustodyAccessLevel.WRITE)).resolves.toEqual({
        custodyAccount: account,
        isLegacy: false,
      });
    });
  });

  describe('getCustodyAccountsForUser', () => {
    it('lists an own account without a grant as write', async () => {
      const account = ownCustodyAccount();
      userDataService.getUserData.mockResolvedValue(ownerUserData({ custodyAccounts: [account] }));
      mockFindActiveGrants([]);

      const result = await service.getCustodyAccountsForUser(ownerId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: ownAccountId,
          accessLevel: CustodyAccessLevel.WRITE,
          isLegacy: false,
        }),
      );
    });

    it('lists an own account with an active read grant as read', async () => {
      const account = ownCustodyAccount();
      const grant = accessGrant({
        account,
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      userDataService.getUserData.mockResolvedValue(ownerUserData({ custodyAccounts: [account] }));
      mockFindActiveGrants([grant]);

      const result = await service.getCustodyAccountsForUser(ownerId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: ownAccountId,
          accessLevel: CustodyAccessLevel.READ,
          isLegacy: false,
        }),
      );
    });

    it('includes a shared foreign account once and does not duplicate the own account', async () => {
      const ownAccount = ownCustodyAccount();
      const foreignAccount = foreignCustodyAccount();
      const ownReadGrant = accessGrant({
        id: 10,
        account: ownAccount,
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      const sharedReadGrant = accessGrant({
        id: 11,
        account: foreignAccount,
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });

      userDataService.getUserData.mockResolvedValue(ownerUserData({ custodyAccounts: [ownAccount] }));
      // Both grants are active and on ACTIVE accounts — mock returns exactly what SQL would
      mockFindActiveGrants([ownReadGrant, sharedReadGrant]);

      const result = await service.getCustodyAccountsForUser(ownerId);

      expect(result).toHaveLength(2);

      const ownEntry = result.find((dto) => dto.id === ownAccountId);
      const sharedEntry = result.find((dto) => dto.id === foreignAccountId);

      expect(ownEntry).toEqual(
        expect.objectContaining({
          id: ownAccountId,
          accessLevel: CustodyAccessLevel.READ,
          isLegacy: false,
        }),
      );
      expect(sharedEntry).toEqual(
        expect.objectContaining({
          id: foreignAccountId,
          accessLevel: CustodyAccessLevel.READ,
          isLegacy: false,
        }),
      );

      // Own account must not appear a second time as "shared"
      const ownOccurrences = result.filter((dto) => dto.id === ownAccountId);
      expect(ownOccurrences).toHaveLength(1);
    });
  });
});
