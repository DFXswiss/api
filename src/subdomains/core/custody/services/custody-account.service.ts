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
import { EntityManager } from 'typeorm';
import { CustodyAccountDto } from '../dto/output/custody-account.dto';
import { CustodyAccountAccess } from '../entities/custody-account-access.entity';
import { CustodyAccount } from '../entities/custody-account.entity';
import { CustodyAccessLevel, CustodyAccountStatus } from '../enums/custody';
import { CustodyAccountDtoMapper } from '../mappers/custody-account-dto.mapper';
import { CustodyAccountAccessRepository } from '../repositories/custody-account-access.repository';
import { CustodyAccountRepository } from '../repositories/custody-account.repository';

export const LegacyAccountId = 'legacy';
export type CustodyAccountId = number | typeof LegacyAccountId;

/** Postgres INTEGER / SERIAL upper bound (positive ids only). */
export const PG_INTEGER_MAX = 2_147_483_647;

/**
 * Owner-scoped advisory lock key for ordinary creation vs legacy materialisation.
 * Must stay identical everywhere — a second key scheme would re-open races.
 */
function custodyLegacyMaterializeLockKey(ownerAccountId: number): string {
  return `custody-legacy-materialize:${ownerAccountId}`;
}

/** Transaction-scoped advisory lock serialising concurrent creation and legacy materialisations. */
async function acquireCustodyLegacyMaterializeLock(manager: EntityManager, ownerAccountId: number): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [custodyLegacyMaterializeLockKey(ownerAccountId)]);
}

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

  /**
   * Resolves an account for authorisation. Only ACTIVE accounts are visible —
   * Blocked/Closed are treated as missing so status cannot be bypassed via id.
   * Shared by checkAccess and requireOwner so every auth path is covered once.
   */
  async getCustodyAccountById(custodyAccountId: number): Promise<CustodyAccount> {
    const custodyAccount = await this.custodyAccountRepo.findOne({
      where: { id: custodyAccountId, status: CustodyAccountStatus.ACTIVE },
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
    // Legacy mode — same entitlement as listing / grantAccessForLegacy (CUSTODY user + no owned rows).
    // Both failures map to NotFound so the alias cannot be used for enumeration or after materialisation.
    if (custodyAccountId === LegacyAccountId) {
      const { hasCustody, ownedCount } = await this.loadLegacyOwner(accountId);
      if (!hasCustody || ownedCount > 0) {
        throw new NotFoundException('Legacy account not found');
      }
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

  /**
   * Resolves a custody account to its owner's user_data id for data reads.
   * Today an account is the owner's entire Safe — no per-account attribution exists
   * (balances/orders never set accountId). Once they carry an account, callers must filter by it.
   */
  async resolveOwnerAccountId(custodyAccountId: CustodyAccountId, callerAccountId: number): Promise<number> {
    const { custodyAccount, isLegacy } = await this.checkAccess(
      custodyAccountId,
      callerAccountId,
      CustodyAccessLevel.READ,
    );

    if (isLegacy) {
      return callerAccountId;
    }

    if (!custodyAccount) {
      throw new NotFoundException('Custody account not found');
    }

    return custodyAccount.owner.id;
  }

  // --- CREATE --- //
  async createCustodyAccount(accountId: number, title: string, description?: string): Promise<CustodyAccount> {
    const owner = await this.userDataService.getActiveUserData(accountId);

    // Same owner-scoped lock as grantAccessForLegacy so ordinary create cannot race
    // materialisation (check-zero → insert) and leave two accounts + a legacy grant.
    return this.custodyAccountRepo.manager.transaction(async (manager) => {
      await acquireCustodyLegacyMaterializeLock(manager, accountId);
      return this.persistCustodyAccount(manager, owner, title, description);
    });
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
    await this.requireOwner(custodyAccountId, accountId);

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
      custodyAccountId !== LegacyAccountId &&
      (typeof custodyAccountId !== 'number' ||
        !Number.isSafeInteger(custodyAccountId) ||
        custodyAccountId < 1 ||
        custodyAccountId > PG_INTEGER_MAX);
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

      await manager.update(CustodyAccountAccess, ...access.deactivate());

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

      await manager.update(CustodyAccountAccess, ...access.deactivate());
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

  /**
   * Owner-only authorisation for grant management. Missing, non-active and foreign
   * accounts all yield the same Forbidden so callers cannot probe existence (403 vs 404).
   * NotFound for missing grant rows stays downstream after ownership is established.
   */
  private async requireOwner(custodyAccountId: number, accountId: number): Promise<CustodyAccount> {
    let custodyAccount: CustodyAccount;
    try {
      custodyAccount = await this.getCustodyAccountById(custodyAccountId);
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw new ForbiddenException('Only the account owner can manage access grants');
      }
      throw e;
    }

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

  /**
   * Loads active owner user_data (+ users) and counts owned custody_account rows.
   * Shared by checkAccess (legacy alias) and grantAccessForLegacy so entitlement stays consistent.
   */
  private async loadLegacyOwner(
    ownerAccountId: number,
  ): Promise<{ owner: UserData; hasCustody: boolean; ownedCount: number }> {
    const owner = await this.userDataService.getActiveUserData(ownerAccountId, { users: true });
    const hasCustody = owner.users.some((u) => u.role === UserRole.CUSTODY);
    const ownedCount = await this.custodyAccountRepo.count({ where: { owner: { id: ownerAccountId } } });
    return { owner, hasCustody, ownedCount };
  }

  private async grantAccessForLegacy(
    ownerAccountId: number,
    mail: string,
    accessLevel: CustodyAccessLevel,
  ): Promise<CustodyAccountAccess> {
    // Authorise legacy entitlement before resolving the e-mail (no enumeration for outsiders).
    const { owner, hasCustody, ownedCount } = await this.loadLegacyOwner(ownerAccountId);
    if (!hasCustody) {
      throw new NotFoundException('Legacy account not found');
    }

    // Legacy Safe = absence of any owned account row (pre-check; re-checked under lock).
    if (ownedCount > 0) {
      throw new BadRequestException('Legacy account not available because custody accounts already exist');
    }

    const target = await this.resolveUserByMail(mail);
    if (target.id === ownerAccountId) {
      throw new BadRequestException('Cannot grant access to yourself');
    }

    return this.custodyAccountRepo.manager.transaction(async (manager) => {
      // Serialize concurrent materialisations for the same owner
      await acquireCustodyLegacyMaterializeLock(manager, ownerAccountId);

      const existingAccounts = await manager.find(CustodyAccount, {
        where: { owner: { id: ownerAccountId } },
        relations: { owner: true },
        order: { id: 'ASC' },
      });

      if (existingAccounts.length > 0) {
        throw new BadRequestException('Legacy account not available because custody accounts already exist');
      }

      // Creates the account + owner grant only. Data rows (balances, orders, users) are
      // deliberately not re-parented: nothing reads accountId/custodyAccountId for
      // authorisation, and account-scoped read paths resolve data through the account owner.
      const account = await this.persistCustodyAccount(manager, owner, 'Custody');

      return this.createGrant(manager, account, target, accessLevel);
    });
  }
}
