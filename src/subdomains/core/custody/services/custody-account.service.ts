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

    // active grants only (history filtered in SQL, not JS) — these cover both foreign accounts
    // the caller may see and own accounts the caller narrowed for themselves
    const activeGrants = await this.custodyAccountAccessRepo.find({
      where: {
        userData: { id: accountId },
        active: true,
        account: { status: CustodyAccountStatus.ACTIVE },
      },
      relations: { account: { owner: true } },
    });
    const sharedAccounts = activeGrants.filter((a) => a.account.owner.id !== accountId);

    // A grant on an own account narrows the owner's level — see checkAccess. Without this the
    // list would offer WRITE where the authorisation only grants inspection.
    const ownLevelByAccount = new Map(
      activeGrants.filter((a) => a.account.owner.id === accountId).map((a) => [a.account.id, a.accessLevel]),
    );

    const custodyAccounts: CustodyAccountDto[] = [
      ...ownedAccounts.map((ca) => {
        const grantedLevel = ownLevelByAccount.get(ca.id);
        // No grant on an own account means the owner keeps full disposal — that is the rule,
        // not a fallback for a missing value.
        const level = grantedLevel === undefined ? CustodyAccessLevel.WRITE : grantedLevel;
        return CustodyAccountDtoMapper.toDto(ca, level);
      }),
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
   * Resolves an account for the data path. Only ACTIVE accounts are visible —
   * Blocked/Closed are treated as missing so status cannot be bypassed via id.
   * Grant management does not go through here: it depends on ownership alone, so blocking an
   * account cannot strand the grants on it (see requireOwner).
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

    // Active grant only — inactive history must not participate in authorisation
    const access = await this.custodyAccountAccessRepo.findOne({
      where: {
        account: { id: custodyAccountId },
        userData: { id: accountId },
        active: true,
      },
    });

    // Owner has WRITE access — unless they granted themselves a narrower level. A signed
    // authorisation can reserve acting for someone else while the owner only inspects; the
    // owner's own grant is the only way to express that, so it must not be overridden here.
    // Managing grants stays with the owner regardless (requireOwner), so this cannot lock
    // anyone out of their own account.
    if (custodyAccount.owner.id === accountId && !access) {
      return { custodyAccount, isLegacy: false };
    }

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
   * Today balances/orders never set accountId, so a read returns the owner's entire Safe.
   *
   * The multi-account refusal is only for grantees: a grant covers one account, but the
   * data layer can only return the owner's whole Safe. If that owner holds more than one
   * custody account (any status — closed/blocked still hold assets), serving the Safe would
   * disclose holdings outside the grant, so refuse with 409 instead of a fabricated subset
   * or an over-broad full Safe. The owner already authorises every one of those rows and
   * reaches them via the caller-scoped endpoints; their own authorisation is total, so the
   * ambiguity check is skipped when the caller is the owner. That still holds once an owner
   * narrows themselves to READ: what a narrowed grant withdraws is acting, not sight — the
   * holdings are the owner's either way, so there is nothing to disclose across a boundary.
   *
   * Once balances and orders carry an account, callers filter by it and this multi-account
   * refusal is no longer needed. Legacy is unaffected (caller has no accounts).
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

    const ownerId = custodyAccount.owner.id;

    // Owner already holds every Safe row; multi-account ambiguity only matters for grantees.
    if (ownerId === callerAccountId) {
      return ownerId;
    }

    const ownedCount = await this.custodyAccountRepo.count({
      where: { owner: { id: ownerId } },
    });
    if (ownedCount > 1) {
      throw new ConflictException(
        'The holdings of this Safe are not attributed to a single account, so the account cannot be read in isolation',
      );
    }

    return ownerId;
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
    // Authorise before touching any grant row. The owner may re-level any grant including
    // their own — see rejectOwnerGrantRevocation for why only revoking stays refused.
    await this.requireOwner(custodyAccountId, ownerAccountId);

    // Read + deactivate + insert under one transaction with a row lock so concurrent
    // update/revoke cannot leave a superseded active grant behind a false revoke success.
    return this.custodyAccountAccessRepo.manager.transaction(async (manager) => {
      const access = await this.lockActiveAccessGrant(manager, custodyAccountId, accessId);

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
      this.rejectOwnerGrantRevocation(access, account);

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
   * Owner-only authorisation for grant management. Missing and foreign accounts yield the same
   * Forbidden so callers cannot probe existence (403 vs 404). NotFound for missing grant rows
   * stays downstream after ownership is established.
   *
   * Status is deliberately not required here, unlike on the data paths. Blocking an account
   * governs what may be done with it, not who decides that. Requiring ACTIVE would strand every
   * grant on a blocked account: the owner could neither lift a narrowing they placed on it nor
   * withdraw a stranger's access, and since a narrowing blocks the owner's whole Safe
   * (requireActingAllowed), one blocked account would freeze all their others with no way back.
   */
  private async requireOwner(custodyAccountId: number, accountId: number): Promise<CustodyAccount> {
    const custodyAccount = await this.custodyAccountRepo.findOne({
      where: { id: custodyAccountId },
      relations: { owner: true },
    });

    if (!custodyAccount || custodyAccount.owner.id !== accountId) {
      throw new ForbiddenException('Only the account owner can manage access grants');
    }

    return custodyAccount;
  }

  /**
   * Refuses acting for an owner who limited themselves to inspection.
   *
   * Orders address a whole Safe, not a single account — balances and orders carry no account
   * today. So any own account narrowed to READ blocks acting: the order could touch exactly
   * those holdings, and serving it would act past the authorisation. Fail closed rather than
   * guess which account an order belongs to.
   *
   * Account status is deliberately not filtered here, unlike everywhere else. Elsewhere a
   * non-active account is treated as absent so it grants nothing; here absence would grant
   * something — the right to act. Blocking or closing an account must never be a way to shed
   * a restriction.
   *
   * Without a narrowing grant this passes, which is every account in production today.
   *
   * The check does not span a lock with the write that follows it, so a narrowing committed in
   * that gap lets one order through. Accepted deliberately: only the owner manages grants and
   * only the owner narrows themselves, so the sole party who could win that race is the one
   * who may lift the restriction outright. There is no adversary to lock out, and holding a
   * lock across order creation would slow every trade to guard against nobody.
   */
  async requireActingAllowed(accountId: number): Promise<void> {
    const narrowed = await this.custodyAccountAccessRepo.findOne({
      where: {
        userData: { id: accountId },
        account: { owner: { id: accountId } },
        accessLevel: CustodyAccessLevel.READ,
        active: true,
      },
    });

    if (narrowed) {
      throw new ForbiddenException('This Safe is limited to inspection, acting is not permitted');
    }
  }

  /**
   * The owner's own grant may be re-levelled but never revoked. Re-levelling is how an owner
   * limits themselves to inspection and hands acting to someone else — and how they take it
   * back, since only the owner reaches this path (requireOwner). Revoking would leave the
   * account without an owner row and make the level unrecordable, so it stays refused.
   */
  private rejectOwnerGrantRevocation(access: CustodyAccountAccess, account: CustodyAccount): void {
    if (access.userData.id === account.owner.id) {
      throw new BadRequestException("Cannot revoke the account owner's access grant");
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
