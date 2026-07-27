import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { EntityManager } from 'typeorm';
import { CustodyAccountDto } from '../dto/output/custody-account.dto';
import { CustodyAccountAccess } from '../entities/custody-account-access.entity';
import { CustodyAccount } from '../entities/custody-account.entity';
import { CustodyBalance } from '../entities/custody-balance.entity';
import { CustodyOrder } from '../entities/custody-order.entity';
import { CustodyAccessLevel, CustodyAccountStatus } from '../enums/custody';
import { CustodyAccountDtoMapper } from '../mappers/custody-account-dto.mapper';
import { CustodyAccountAccessRepository } from '../repositories/custody-account-access.repository';
import { CustodyAccountRepository } from '../repositories/custody-account.repository';

export const LegacyAccountId = 'legacy';
export type CustodyAccountId = number | typeof LegacyAccountId;

@Injectable()
export class CustodyAccountService {
  constructor(
    private readonly custodyAccountRepo: CustodyAccountRepository,
    private readonly custodyAccountAccessRepo: CustodyAccountAccessRepository,
    private readonly userDataService: UserDataService,
  ) {}

  // --- GET CUSTODY ACCOUNTS --- //
  async getCustodyAccountsForUser(accountId: number): Promise<CustodyAccountDto[]> {
    const account = await this.userDataService.getUserData(accountId, {
      users: true,
      custodyAccounts: true,
    });
    if (!account) throw new NotFoundException('User not found');

    // owned accounts (active only for the list)
    const allOwnedAccounts = account.custodyAccounts ?? [];
    const ownedAccounts = allOwnedAccounts.filter((ca) => ca.status === CustodyAccountStatus.ACTIVE);

    // shared accounts via active grants only (history filtered in SQL, not JS)
    const activeSharedGrants = await this.custodyAccountAccessRepo.find({
      where: {
        userData: { id: accountId },
        active: true,
        account: { status: CustodyAccountStatus.ACTIVE },
      },
      relations: { account: { owner: true } },
    });
    const sharedAccounts = activeSharedGrants.filter((a) => a.account.owner.id !== accountId);

    const custodyAccounts: CustodyAccountDto[] = [
      ...ownedAccounts.map((ca) => CustodyAccountDtoMapper.toDto(ca, CustodyAccessLevel.WRITE)),
      ...sharedAccounts.map((a) => CustodyAccountDtoMapper.toDto(a.account, a.accessLevel)),
    ];

    // Legacy Safe = absence of any owned account row; independent of shared grants.
    if (allOwnedAccounts.length === 0) {
      const hasCustody = account.users.some((u) => u.role === UserRole.CUSTODY);
      if (hasCustody) {
        custodyAccounts.push(CustodyAccountDtoMapper.toLegacyDto(account));
      }
    }

    return custodyAccounts;
  }

  async getCustodyAccountById(custodyAccountId: number): Promise<CustodyAccount> {
    const custodyAccount = await this.custodyAccountRepo.findOne({
      where: { id: custodyAccountId },
      relations: { owner: true },
    });

    if (!custodyAccount) throw new NotFoundException('Custody account not found');

    return custodyAccount;
  }

  // --- ACCESS CHECK --- //
  async checkAccess(
    custodyAccountId: CustodyAccountId,
    accountId: number,
    requiredLevel: CustodyAccessLevel,
  ): Promise<{ custodyAccount: CustodyAccount | null; isLegacy: boolean }> {
    // Legacy mode
    if (custodyAccountId === LegacyAccountId) {
      if (requiredLevel === CustodyAccessLevel.WRITE) {
        throw new ForbiddenException('Cannot modify legacy account');
      }
      return { custodyAccount: null, isLegacy: true };
    }

    const custodyAccount = await this.getCustodyAccountById(custodyAccountId);

    // Owner has WRITE access
    if (custodyAccount.owner.id === accountId) {
      return { custodyAccount, isLegacy: false };
    }

    // Active grant only — inactive history must not participate in authorisation
    const access = await this.custodyAccountAccessRepo.findOne({
      where: {
        account: { id: custodyAccountId },
        userData: { id: accountId },
        active: true,
      },
    });
    if (!access) {
      throw new ForbiddenException('No access to this custody account');
    }

    // Check if access level is sufficient
    if (requiredLevel === CustodyAccessLevel.WRITE && access.accessLevel === CustodyAccessLevel.READ) {
      throw new ForbiddenException('Write access required');
    }

    return { custodyAccount, isLegacy: false };
  }

  // --- CREATE --- //
  async createCustodyAccount(accountId: number, title: string, description?: string): Promise<CustodyAccount> {
    const owner = await this.userDataService.getActiveUserData(accountId);

    return this.persistCustodyAccount(this.custodyAccountRepo.manager, owner, title, description);
  }

  // --- UPDATE --- //
  async updateCustodyAccount(
    custodyAccountId: number,
    accountId: number,
    title?: string,
    description?: string,
  ): Promise<CustodyAccount> {
    const { custodyAccount } = await this.checkAccess(custodyAccountId, accountId, CustodyAccessLevel.WRITE);

    Object.assign(custodyAccount, { title, description });

    return this.custodyAccountRepo.save(custodyAccount);
  }

  // --- GET ACCESS LIST --- //
  async getAccessList(custodyAccountId: number, accountId: number): Promise<CustodyAccountAccess[]> {
    await this.checkAccess(custodyAccountId, accountId, CustodyAccessLevel.READ);

    return this.custodyAccountAccessRepo.find({
      where: { account: { id: custodyAccountId }, active: true },
      relations: { userData: true },
    });
  }

  // --- GRANT ACCESS --- //
  async grantAccess(
    custodyAccountId: CustodyAccountId,
    ownerAccountId: number,
    mail: string,
    accessLevel: CustodyAccessLevel,
  ): Promise<CustodyAccountAccess> {
    const isInvalidNumericId =
      custodyAccountId !== LegacyAccountId && (typeof custodyAccountId !== 'number' || Number.isNaN(custodyAccountId));
    if (isInvalidNumericId) {
      throw new BadRequestException('Invalid custody account ID');
    }

    // Authorise the Safe first (ownership / legacy entitlement) so e-mail resolution cannot
    // leak whether an address is registered to callers without access.
    if (custodyAccountId === LegacyAccountId) {
      return this.grantAccessForLegacy(ownerAccountId, mail, accessLevel);
    }

    const account = await this.requireOwner(custodyAccountId, ownerAccountId);

    const target = await this.resolveUserByMail(mail);
    if (target.id === ownerAccountId) {
      throw new BadRequestException('Cannot grant access to yourself');
    }

    return this.createGrant(this.custodyAccountAccessRepo.manager, account, target, accessLevel);
  }

  async updateAccess(
    custodyAccountId: number,
    accessId: number,
    ownerAccountId: number,
    accessLevel: CustodyAccessLevel,
  ): Promise<CustodyAccountAccess> {
    const account = await this.requireOwner(custodyAccountId, ownerAccountId);

    // Read + deactivate + insert under one transaction with a row lock so concurrent
    // update/revoke cannot leave a superseded active grant behind a false revoke success.
    return this.custodyAccountAccessRepo.manager.transaction(async (manager) => {
      const access = await this.lockActiveAccessGrant(manager, custodyAccountId, accessId);
      this.rejectOwnerGrantMutation(access, account, 'modify');

      if (access.accessLevel === accessLevel) {
        return access;
      }

      access.deactivate();
      await manager.save(access);

      const grant = manager.create(CustodyAccountAccess, {
        account: access.account,
        userData: access.userData,
        accessLevel,
        active: true,
      });

      return this.saveGrant(manager, grant);
    });
  }

  async revokeAccess(custodyAccountId: number, accessId: number, ownerAccountId: number): Promise<void> {
    const account = await this.requireOwner(custodyAccountId, ownerAccountId);

    await this.custodyAccountAccessRepo.manager.transaction(async (manager) => {
      const access = await this.lockActiveAccessGrant(manager, custodyAccountId, accessId);
      this.rejectOwnerGrantMutation(access, account, 'revoke');

      access.deactivate();
      await manager.save(access);
    });
  }

  // --- HELPER METHODS --- //
  private async resolveUserByMail(mail: string): Promise<UserData> {
    const users = await this.userDataService.getUsersByMail(mail, true, {});
    if (users.length === 0) {
      throw new NotFoundException('User with this e-mail not found');
    }
    if (users.length > 1) {
      throw new ConflictException('Multiple users found for this e-mail');
    }

    return users[0];
  }

  private async requireOwner(custodyAccountId: number, accountId: number): Promise<CustodyAccount> {
    const custodyAccount = await this.getCustodyAccountById(custodyAccountId);
    if (custodyAccount.owner.id !== accountId) {
      throw new ForbiddenException('Only the account owner can manage access grants');
    }

    return custodyAccount;
  }

  private rejectOwnerGrantMutation(
    access: CustodyAccountAccess,
    account: CustodyAccount,
    action: 'modify' | 'revoke',
  ): void {
    if (access.userData.id === account.owner.id) {
      throw new BadRequestException(
        action === 'revoke'
          ? "Cannot revoke the account owner's access grant"
          : "Cannot modify the account owner's access grant",
      );
    }
  }

  /**
   * Locks the active grant row (SELECT … FOR UPDATE OF access) so concurrent update/revoke
   * serialise on the same row. A lost race (row already inactive / missing) yields NotFound —
   * never a false success.
   */
  private async lockActiveAccessGrant(
    manager: EntityManager,
    custodyAccountId: number,
    accessId: number,
  ): Promise<CustodyAccountAccess> {
    const access = await manager
      .createQueryBuilder(CustodyAccountAccess, 'access')
      .innerJoinAndSelect('access.userData', 'userData')
      .innerJoinAndSelect('access.account', 'account')
      .where('access.id = :accessId', { accessId })
      .andWhere('access.active = :active', { active: true })
      .andWhere('account.id = :custodyAccountId', { custodyAccountId })
      .setLock('pessimistic_write', undefined, ['access'])
      .getOne();

    if (!access) {
      throw new NotFoundException('Access grant not found');
    }

    return access;
  }

  private async createGrant(
    manager: EntityManager,
    account: CustodyAccount,
    target: UserData,
    accessLevel: CustodyAccessLevel,
  ): Promise<CustodyAccountAccess> {
    const existing = await manager.findOne(CustodyAccountAccess, {
      where: { account: { id: account.id }, userData: { id: target.id }, active: true },
    });
    if (existing) {
      throw new ConflictException('Access grant already exists for this user');
    }

    const grant = manager.create(CustodyAccountAccess, {
      account,
      userData: target,
      accessLevel,
      active: true,
    });

    return this.saveGrant(manager, grant);
  }

  private async saveGrant(manager: EntityManager, grant: CustodyAccountAccess): Promise<CustodyAccountAccess> {
    try {
      return await manager.save(grant);
    } catch (e) {
      // Concurrent insert lost the unique race (SQLSTATE 23505) → same 409 as the pre-check.
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Access grant already exists for this user');
      }
      throw e;
    }
  }

  private async persistCustodyAccount(
    manager: EntityManager,
    owner: UserData,
    title: string,
    description?: string,
  ): Promise<CustodyAccount> {
    const custodyAccount = manager.create(CustodyAccount, {
      title,
      description,
      owner,
      status: CustodyAccountStatus.ACTIVE,
      requiredSignatures: 1,
    });

    const saved = await manager.save(custodyAccount);

    const ownerAccess = manager.create(CustodyAccountAccess, {
      account: saved,
      userData: owner,
      accessLevel: CustodyAccessLevel.WRITE,
      active: true,
    });
    await manager.save(ownerAccess);

    return saved;
  }

  private async grantAccessForLegacy(
    ownerAccountId: number,
    mail: string,
    accessLevel: CustodyAccessLevel,
  ): Promise<CustodyAccountAccess> {
    // Authorise legacy entitlement before resolving the e-mail (no enumeration for outsiders).
    const owner = await this.userDataService.getActiveUserData(ownerAccountId, { users: true });
    const hasCustody = owner.users.some((u) => u.role === UserRole.CUSTODY);
    if (!hasCustody) {
      throw new NotFoundException('Legacy account not found');
    }

    // Legacy Safe = absence of any owned account row (pre-check; re-checked under lock).
    const ownedCount = await this.custodyAccountRepo.count({ where: { owner: { id: ownerAccountId } } });
    if (ownedCount > 0) {
      throw new BadRequestException('Legacy account not available because custody accounts already exist');
    }

    const target = await this.resolveUserByMail(mail);
    if (target.id === ownerAccountId) {
      throw new BadRequestException('Cannot grant access to yourself');
    }

    return this.custodyAccountRepo.manager.transaction(async (manager) => {
      // Serialize concurrent materialisations for the same owner
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `custody-legacy-materialize:${ownerAccountId}`,
      ]);

      const existingAccounts = await manager.find(CustodyAccount, {
        where: { owner: { id: ownerAccountId } },
        relations: { owner: true },
        order: { id: 'ASC' },
      });

      if (existingAccounts.length > 0) {
        throw new BadRequestException('Legacy account not available because custody accounts already exist');
      }

      const account = await this.persistCustodyAccount(manager, owner, 'Custody');
      await this.attachLegacyCustodyData(manager, account, owner);

      return this.createGrant(manager, account, target, accessLevel);
    });
  }

  private async attachLegacyCustodyData(
    manager: EntityManager,
    account: CustodyAccount,
    owner: UserData,
  ): Promise<void> {
    const custodyUserIds = owner.users.filter((u) => u.role === UserRole.CUSTODY).map((u) => u.id);
    if (custodyUserIds.length === 0) return;

    // Set the `account` relation itself — there is no `accountId` property on the entities,
    // and casting one in hides that from the compiler until it fails at runtime. The column
    // names are camelCase and therefore have to stay quoted for Postgres.
    // Only reparent rows that are still unassigned (NULL account) so foreign/closed accounts
    // are never hijacked.
    await manager
      .createQueryBuilder()
      .update(CustodyBalance)
      .set({ account })
      .where('"userId" IN (:...userIds)', { userIds: custodyUserIds })
      .andWhere('"accountId" IS NULL')
      .execute();

    await manager
      .createQueryBuilder()
      .update(CustodyOrder)
      .set({ account })
      .where('"userId" IN (:...userIds)', { userIds: custodyUserIds })
      .andWhere('"accountId" IS NULL')
      .execute();

    // Complete the association on the custody User rows (only where still unassigned).
    await manager
      .createQueryBuilder()
      .update(User)
      .set({ custodyAccount: account })
      .where('id IN (:...userIds)', { userIds: custodyUserIds })
      .andWhere('"custodyAccountId" IS NULL')
      .execute();
  }
}
