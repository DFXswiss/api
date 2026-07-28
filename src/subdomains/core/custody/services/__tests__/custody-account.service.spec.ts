import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { EntityManager, FindManyOptions, FindOneOptions } from 'typeorm';
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
   * Mirrors the repository where clause for requireOwner: `{ id }`.
   * Status is deliberately absent there, so a non-matching status returns null if that filter
   * is accidentally reintroduced.
   */
  function mockFindOneAccountForOwnerCheck(account: CustodyAccount | undefined): void {
    custodyAccountRepo.findOne.mockImplementation(
      async (options: FindOneOptions<CustodyAccount>): Promise<CustodyAccount | null> => {
        const where = options.where as {
          id?: number;
          status?: CustodyAccountStatus;
        };

        if (!account) {
          return null;
        }

        if (where.id !== undefined && account.id !== where.id) {
          return null;
        }

        if (where.status !== undefined && account.status !== where.status) {
          return null;
        }

        return account;
      },
    );
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

  /**
   * Mirrors the repository where clause for requireActingAllowed:
   * `{ userData: { id }, account: { owner: { id } }, accessLevel: READ, active: true }`.
   * Account status is deliberately absent there — blocking must not shed a narrowing — so the
   * status branch below never fires for that query; it stays to keep the mock honest if the
   * clause ever changes.
   */
  function mockFindOneActingGrant(grant: CustodyAccountAccess | undefined): void {
    custodyAccountAccessRepo.findOne.mockImplementation(
      async (options: FindOneOptions<CustodyAccountAccess>): Promise<CustodyAccountAccess | null> => {
        const where = options.where as {
          userData?: { id?: number };
          account?: { owner?: { id?: number }; status?: CustodyAccountStatus };
          accessLevel?: CustodyAccessLevel;
          active?: boolean;
        };

        if (!grant) {
          return null;
        }

        if (where.userData?.id !== undefined && grant.userData.id !== where.userData.id) {
          return null;
        }

        if (where.account?.owner?.id !== undefined && grant.account.owner.id !== where.account.owner.id) {
          return null;
        }

        if (where.account?.status !== undefined && grant.account.status !== where.account.status) {
          return null;
        }

        if (where.accessLevel !== undefined && grant.accessLevel !== where.accessLevel) {
          return null;
        }

        if (where.active === true && !grant.active) {
          return null;
        }

        return grant;
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

    it("filters out inactive grants, another user's grants, and grants on non-active accounts", async () => {
      const account = ownCustodyAccount();
      const legitimateGrant = accessGrant({
        id: 10,
        account,
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });

      // Noise: inactive grant for the caller on an otherwise qualifying foreign account
      const inactiveNoiseAccount = foreignCustodyAccount({ id: 3 });
      const inactiveGrant = accessGrant({
        id: 11,
        account: inactiveNoiseAccount,
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: false,
      });

      // Noise: active grant belonging to a different userData
      const strangerGrantAccount = foreignCustodyAccount({ id: 4 });
      const strangerGrant = accessGrant({
        id: 12,
        account: strangerGrantAccount,
        userData: strangerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });

      // Noise: active grant for the caller on a non-ACTIVE account
      const blockedAccount = foreignCustodyAccount({ id: 5, status: CustodyAccountStatus.BLOCKED });
      const blockedGrant = accessGrant({
        id: 13,
        account: blockedAccount,
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });

      userDataService.getUserData.mockResolvedValue(ownerUserData({ custodyAccounts: [account] }));
      mockFindActiveGrants([legitimateGrant, inactiveGrant, strangerGrant, blockedGrant]);

      const result = await service.getCustodyAccountsForUser(ownerId);

      expect(result).toHaveLength(1);
      expect(result.map((dto) => dto.id).sort()).toEqual([ownAccountId]);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: ownAccountId,
          accessLevel: CustodyAccessLevel.READ,
          isLegacy: false,
        }),
      );
    });
  });

  describe('getAccessList', () => {
    it('lets the owner inspect active grants on their blocked account', async () => {
      const blockedOwnAccount = ownCustodyAccount({ status: CustodyAccountStatus.BLOCKED });
      const grant = accessGrant({
        account: blockedOwnAccount,
        userData: strangerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      mockFindOneAccountForOwnerCheck(blockedOwnAccount);
      custodyAccountAccessRepo.find.mockResolvedValue([grant]);

      await expect(service.getAccessList(ownAccountId, ownerId)).resolves.toEqual([grant]);
      expect(custodyAccountAccessRepo.find).toHaveBeenCalledWith({
        where: { account: { id: ownAccountId }, active: true },
        relations: { userData: true },
      });
    });

    it('rejects a non-owner', async () => {
      mockFindOneAccountForOwnerCheck(foreignCustodyAccount());

      await expect(service.getAccessList(foreignAccountId, ownerId)).rejects.toThrow(
        new ForbiddenException('Only the account owner can manage access grants'),
      );
      expect(custodyAccountAccessRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('grantAccess', () => {
    const mail = 'stranger@example.com';

    let txManager: {
      findOne: jest.Mock;
      create: jest.Mock;
      save: jest.Mock;
    };

    beforeEach(() => {
      txManager = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn(
          (_entityClass: unknown, plain: Partial<CustodyAccountAccess>): CustodyAccountAccess =>
            Object.assign(new CustodyAccountAccess(), plain),
        ),
        save: jest.fn(async (entity: CustodyAccountAccess): Promise<CustodyAccountAccess> => entity),
      };

      Object.defineProperty(custodyAccountAccessRepo, 'manager', {
        value: txManager as unknown as EntityManager,
        configurable: true,
      });
    });

    it('creates a grant for a foreign e-mail address on an active own account', async () => {
      const account = ownCustodyAccount();
      const target = strangerUserData();
      mockFindOneAccountForOwnerCheck(account);
      userDataService.getUsersByMail.mockResolvedValue([target]);

      const result = await service.grantAccess(ownAccountId, ownerId, mail, CustodyAccessLevel.READ);

      expect(userDataService.getUsersByMail).toHaveBeenCalledWith(mail, true, {});
      expect(txManager.findOne).toHaveBeenCalledWith(CustodyAccountAccess, {
        where: { account: { id: ownAccountId }, userData: { id: strangerId }, active: true },
      });
      expect(txManager.create).toHaveBeenCalledWith(CustodyAccountAccess, {
        account,
        userData: target,
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      expect(result).toEqual(
        expect.objectContaining({
          account,
          userData: target,
          accessLevel: CustodyAccessLevel.READ,
          active: true,
        }),
      );
    });

    it('rejects granting on a blocked own account before resolving the e-mail address', async () => {
      const blockedOwnAccount = ownCustodyAccount({ status: CustodyAccountStatus.BLOCKED });
      mockFindOneAccountForOwnerCheck(blockedOwnAccount);

      await expect(service.grantAccess(ownAccountId, ownerId, mail, CustodyAccessLevel.READ)).rejects.toThrow(
        new BadRequestException('Cannot grant access on an account that is not active'),
      );
      expect(userDataService.getUsersByMail).not.toHaveBeenCalled();
      expect(txManager.findOne).not.toHaveBeenCalled();
    });

    it('rejects granting write on a blocked own account just the same', async () => {
      // The refusal must not depend on the level asked for: inspection is no more grantable
      // during a hold than acting is.
      const blockedOwnAccount = ownCustodyAccount({ status: CustodyAccountStatus.BLOCKED });
      mockFindOneAccountForOwnerCheck(blockedOwnAccount);

      await expect(service.grantAccess(ownAccountId, ownerId, mail, CustodyAccessLevel.WRITE)).rejects.toThrow(
        new BadRequestException('Cannot grant access on an account that is not active'),
      );
      expect(userDataService.getUsersByMail).not.toHaveBeenCalled();
    });

    it('rejects a non-owner', async () => {
      mockFindOneAccountForOwnerCheck(foreignCustodyAccount());

      await expect(service.grantAccess(foreignAccountId, ownerId, mail, CustodyAccessLevel.READ)).rejects.toThrow(
        new ForbiddenException('Only the account owner can manage access grants'),
      );
      expect(userDataService.getUsersByMail).not.toHaveBeenCalled();
      expect(txManager.findOne).not.toHaveBeenCalled();
    });

    it("rejects granting access to the caller's own e-mail address", async () => {
      const account = ownCustodyAccount();
      mockFindOneAccountForOwnerCheck(account);
      userDataService.getUsersByMail.mockResolvedValue([ownerUserData()]);

      await expect(service.grantAccess(ownAccountId, ownerId, mail, CustodyAccessLevel.WRITE)).rejects.toThrow(
        new BadRequestException('Cannot grant access to yourself'),
      );
      expect(txManager.findOne).not.toHaveBeenCalled();
    });
  });

  describe('updateAccess', () => {
    const accessId = 10;

    let accessQuery: {
      innerJoinAndSelect: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      setLock: jest.Mock;
      getOne: jest.Mock;
    };
    let txManager: {
      createQueryBuilder: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      save: jest.Mock;
    };

    beforeEach(() => {
      accessQuery = {
        innerJoinAndSelect: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        setLock: jest.fn(),
        getOne: jest.fn(),
      };
      for (const method of ['innerJoinAndSelect', 'where', 'andWhere', 'setLock'] as const) {
        accessQuery[method].mockReturnValue(accessQuery);
      }

      txManager = {
        createQueryBuilder: jest.fn().mockReturnValue(accessQuery),
        update: jest.fn(),
        create: jest.fn(
          (_entityClass: unknown, plain: Partial<CustodyAccountAccess>): CustodyAccountAccess =>
            Object.assign(new CustodyAccountAccess(), plain),
        ),
        save: jest.fn(async (entity: CustodyAccountAccess): Promise<CustodyAccountAccess> => entity),
      };

      Object.defineProperty(custodyAccountAccessRepo, 'manager', {
        value: {
          transaction: jest.fn(<T>(cb: (manager: EntityManager) => Promise<T>) =>
            cb(txManager as unknown as EntityManager),
          ),
        },
        configurable: true,
      });

      custodyAccountRepo.findOne.mockResolvedValue(ownCustodyAccount());
    });

    it("narrows the owner's own grant from write to read", async () => {
      const lockedGrant = accessGrant({
        id: accessId,
        account: ownCustodyAccount(),
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.WRITE,
        active: true,
      });
      accessQuery.getOne.mockResolvedValue(lockedGrant);

      const result = await service.updateAccess(ownAccountId, accessId, ownerId, CustodyAccessLevel.READ);

      expect(custodyAccountRepo.findOne).toHaveBeenCalled();
      expect(txManager.update).toHaveBeenCalledTimes(1);
      expect(txManager.create).toHaveBeenCalledTimes(1);
      expect(txManager.create).toHaveBeenCalledWith(
        CustodyAccountAccess,
        expect.objectContaining({
          accessLevel: CustodyAccessLevel.READ,
          active: true,
        }),
      );
      expect(txManager.save).toHaveBeenCalledTimes(1);
      expect(txManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accessLevel: CustodyAccessLevel.READ,
          active: true,
        }),
      );
      expect(result.accessLevel).toBe(CustodyAccessLevel.READ);
    });

    it('lets the owner lift a narrowing on a blocked account so one block cannot freeze their Safe', async () => {
      // A narrowing blocks the owner's whole Safe (requireActingAllowed) and does not care about
      // account status. If grant management required an ACTIVE account, blocking one account
      // would freeze every other one of theirs with no way back.
      const blockedOwnAccount = ownCustodyAccount({ status: CustodyAccountStatus.BLOCKED });
      mockFindOneAccountForOwnerCheck(blockedOwnAccount);

      const lockedGrant = accessGrant({
        id: accessId,
        account: blockedOwnAccount,
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      accessQuery.getOne.mockResolvedValue(lockedGrant);

      const result = await service.updateAccess(ownAccountId, accessId, ownerId, CustodyAccessLevel.WRITE);

      expect(result.accessLevel).toBe(CustodyAccessLevel.WRITE);
      expect(txManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ accessLevel: CustodyAccessLevel.WRITE, active: true }),
      );
    });

    it("restores the owner's own grant from read back to write", async () => {
      const lockedGrant = accessGrant({
        id: accessId,
        account: ownCustodyAccount(),
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      accessQuery.getOne.mockResolvedValue(lockedGrant);

      const result = await service.updateAccess(ownAccountId, accessId, ownerId, CustodyAccessLevel.WRITE);

      expect(txManager.update).toHaveBeenCalledTimes(1);
      expect(txManager.create).toHaveBeenCalledTimes(1);
      expect(txManager.save).toHaveBeenCalledTimes(1);
      expect(result.accessLevel).toBe(CustodyAccessLevel.WRITE);
    });

    it('does nothing when the requested level already matches (short-circuit)', async () => {
      const lockedGrant = accessGrant({
        id: accessId,
        account: ownCustodyAccount(),
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      accessQuery.getOne.mockResolvedValue(lockedGrant);

      const result = await service.updateAccess(ownAccountId, accessId, ownerId, CustodyAccessLevel.READ);

      expect(result).toBe(lockedGrant);
      expect(txManager.update).not.toHaveBeenCalled();
      expect(txManager.create).not.toHaveBeenCalled();
      expect(txManager.save).not.toHaveBeenCalled();
    });

    it('rejects updateAccess from a non-owner', async () => {
      await expect(service.updateAccess(ownAccountId, accessId, strangerId, CustodyAccessLevel.READ)).rejects.toThrow(
        ForbiddenException,
      );

      expect(txManager.createQueryBuilder).not.toHaveBeenCalled();
    });

    it("rejects raising a stranger's access on a blocked account and writes nothing", async () => {
      const blockedOwnAccount = ownCustodyAccount({ status: CustodyAccountStatus.BLOCKED });
      mockFindOneAccountForOwnerCheck(blockedOwnAccount);

      const lockedGrant = accessGrant({
        id: accessId,
        account: blockedOwnAccount,
        userData: strangerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      accessQuery.getOne.mockResolvedValue(lockedGrant);

      await expect(service.updateAccess(ownAccountId, accessId, ownerId, CustodyAccessLevel.WRITE)).rejects.toThrow(
        new BadRequestException('Cannot raise access on an account that is not active'),
      );
      expect(txManager.update).not.toHaveBeenCalled();
      expect(txManager.create).not.toHaveBeenCalled();
      expect(txManager.save).not.toHaveBeenCalled();
    });

    it("lets a stranger's access be lowered on a blocked account", async () => {
      const blockedOwnAccount = ownCustodyAccount({ status: CustodyAccountStatus.BLOCKED });
      mockFindOneAccountForOwnerCheck(blockedOwnAccount);

      const lockedGrant = accessGrant({
        id: accessId,
        account: blockedOwnAccount,
        userData: strangerUserData(),
        accessLevel: CustodyAccessLevel.WRITE,
        active: true,
      });
      accessQuery.getOne.mockResolvedValue(lockedGrant);

      const result = await service.updateAccess(ownAccountId, accessId, ownerId, CustodyAccessLevel.READ);

      expect(result.accessLevel).toBe(CustodyAccessLevel.READ);
      expect(txManager.update).toHaveBeenCalledTimes(1);
      expect(txManager.create).toHaveBeenCalledTimes(1);
      expect(txManager.create).toHaveBeenCalledWith(
        CustodyAccountAccess,
        expect.objectContaining({
          accessLevel: CustodyAccessLevel.READ,
          active: true,
        }),
      );
      expect(txManager.save).toHaveBeenCalledTimes(1);
    });

    it("still lets a stranger's access be raised on an active account", async () => {
      const activeOwnAccount = ownCustodyAccount();
      mockFindOneAccountForOwnerCheck(activeOwnAccount);

      const lockedGrant = accessGrant({
        id: accessId,
        account: activeOwnAccount,
        userData: strangerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      accessQuery.getOne.mockResolvedValue(lockedGrant);

      const result = await service.updateAccess(ownAccountId, accessId, ownerId, CustodyAccessLevel.WRITE);

      expect(result.accessLevel).toBe(CustodyAccessLevel.WRITE);
      expect(txManager.update).toHaveBeenCalledTimes(1);
      expect(txManager.create).toHaveBeenCalledTimes(1);
      expect(txManager.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('revokeAccess', () => {
    const accessId = 10;

    let accessQuery: {
      innerJoinAndSelect: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      setLock: jest.Mock;
      getOne: jest.Mock;
    };
    let txManager: {
      createQueryBuilder: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      save: jest.Mock;
    };

    beforeEach(() => {
      accessQuery = {
        innerJoinAndSelect: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        setLock: jest.fn(),
        getOne: jest.fn(),
      };
      for (const method of ['innerJoinAndSelect', 'where', 'andWhere', 'setLock'] as const) {
        accessQuery[method].mockReturnValue(accessQuery);
      }

      txManager = {
        createQueryBuilder: jest.fn().mockReturnValue(accessQuery),
        update: jest.fn(),
        create: jest.fn(
          (_entityClass: unknown, plain: Partial<CustodyAccountAccess>): CustodyAccountAccess =>
            Object.assign(new CustodyAccountAccess(), plain),
        ),
        save: jest.fn(async (entity: CustodyAccountAccess): Promise<CustodyAccountAccess> => entity),
      };

      Object.defineProperty(custodyAccountAccessRepo, 'manager', {
        value: {
          transaction: jest.fn(<T>(cb: (manager: EntityManager) => Promise<T>) =>
            cb(txManager as unknown as EntityManager),
          ),
        },
        configurable: true,
      });

      custodyAccountRepo.findOne.mockResolvedValue(ownCustodyAccount());
    });

    it("rejects revoking the owner's own access grant", async () => {
      const lockedGrant = accessGrant({
        id: accessId,
        account: ownCustodyAccount(),
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.WRITE,
        active: true,
      });
      accessQuery.getOne.mockResolvedValue(lockedGrant);

      await expect(service.revokeAccess(ownAccountId, accessId, ownerId)).rejects.toThrow(BadRequestException);
      expect(txManager.update).not.toHaveBeenCalled();
    });

    it("revokes a foreign grantee's access", async () => {
      const lockedGrant = accessGrant({
        id: accessId,
        account: ownCustodyAccount(),
        userData: strangerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      accessQuery.getOne.mockResolvedValue(lockedGrant);

      await expect(service.revokeAccess(ownAccountId, accessId, ownerId)).resolves.toBeUndefined();
      expect(txManager.update).toHaveBeenCalledTimes(1);
      expect(txManager.update).toHaveBeenCalledWith(
        CustodyAccountAccess,
        accessId,
        expect.objectContaining({ active: false }),
      );
    });

    it('rejects revokeAccess from a non-owner', async () => {
      await expect(service.revokeAccess(ownAccountId, accessId, strangerId)).rejects.toThrow(ForbiddenException);
      expect(txManager.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('requireActingAllowed', () => {
    it('allows acting when no grant is configured', async () => {
      mockFindOneActingGrant(undefined);

      await expect(service.requireActingAllowed(ownerId)).resolves.toBeUndefined();
    });

    it('rejects acting when the owner has an active read grant on their own account', async () => {
      const grant = accessGrant({
        account: ownCustodyAccount(),
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      mockFindOneActingGrant(grant);

      await expect(service.requireActingAllowed(ownerId)).rejects.toThrow(
        new ForbiddenException('This Safe is limited to inspection, acting is not permitted'),
      );
    });

    it('allows acting when the owner has an active write grant on their own account', async () => {
      const grant = accessGrant({
        account: ownCustodyAccount(),
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.WRITE,
        active: true,
      });
      mockFindOneActingGrant(grant);

      await expect(service.requireActingAllowed(ownerId)).resolves.toBeUndefined();
    });

    it('allows acting on the own safe when the owner holds a read grant only on a foreign account', async () => {
      const grant = accessGrant({
        account: foreignCustodyAccount(),
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      mockFindOneActingGrant(grant);

      await expect(service.requireActingAllowed(ownerId)).resolves.toBeUndefined();
    });

    it('allows acting when the owner read grant on their own account is inactive', async () => {
      const grant = accessGrant({
        account: ownCustodyAccount(),
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: false,
      });
      mockFindOneActingGrant(grant);

      await expect(service.requireActingAllowed(ownerId)).resolves.toBeUndefined();
    });

    it('still rejects acting when the narrowed own account is blocked', async () => {
      // Blocking an account must not be a way to shed the restriction: elsewhere a non-active
      // account grants nothing, here its absence would grant the right to act.
      const grant = accessGrant({
        account: ownCustodyAccount({ status: CustodyAccountStatus.BLOCKED }),
        userData: ownerUserData(),
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      });
      mockFindOneActingGrant(grant);

      await expect(service.requireActingAllowed(ownerId)).rejects.toThrow(ForbiddenException);
    });
  });
});
