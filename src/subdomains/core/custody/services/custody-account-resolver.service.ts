import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { EntityManager } from 'typeorm';
import { CustodyAccount } from '../entities/custody-account.entity';
import { CustodyAccountRepository } from '../repositories/custody-account.repository';

/**
 * Owner-scoped advisory lock key shared by legacy materialisation and resolve-and-create paths.
 * Must stay identical everywhere — a second key scheme would re-open the race.
 */
export function custodyLegacyMaterializeLockKey(ownerAccountId: number): string {
  return `custody-legacy-materialize:${ownerAccountId}`;
}

/**
 * Transaction-scoped advisory lock used to serialise legacy materialisation with
 * resolve-and-insert on order / balance / new custody-user creation for the same owner.
 */
export async function acquireCustodyLegacyMaterializeLock(
  manager: EntityManager,
  ownerAccountId: number,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [custodyLegacyMaterializeLockKey(ownerAccountId)]);
}

/**
 * Dependency-light account resolution for creation paths (order, balance, new custody user).
 *
 * Kept separate from {@link CustodyAccountService} so creation services can resolve accounts
 * without pulling in UserDataService and closing a Nest DI cycle through the custody graph.
 *
 * Always reads the FK from the database — never from a possibly-unloaded relation.
 */
@Injectable()
export class CustodyAccountResolver {
  constructor(private readonly custodyAccountRepo: CustodyAccountRepository) {}

  /**
   * Runs `fn` inside a transaction that holds the owner-scoped legacy-materialise advisory lock.
   * Use for create paths keyed by an existing custody user id (order / balance).
   */
  async withLegacyMaterializeLockForUser<T>(userId: number, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.custodyAccountRepo.manager.transaction(async (manager) => {
      const ownerUserDataId = await this.resolveOwnerUserDataId(userId, manager);
      await acquireCustodyLegacyMaterializeLock(manager, ownerUserDataId);
      return fn(manager);
    });
  }

  /**
   * Runs `fn` inside a transaction that holds the owner-scoped legacy-materialise advisory lock.
   * Use for create paths keyed by the owner user-data id (new custody user).
   */
  async withLegacyMaterializeLockForOwner<T>(
    ownerUserDataId: number,
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (ownerUserDataId == null) {
      throw new BadRequestException('Owner user data id is required for legacy materialise lock');
    }

    return this.custodyAccountRepo.manager.transaction(async (manager) => {
      await acquireCustodyLegacyMaterializeLock(manager, ownerUserDataId);
      return fn(manager);
    });
  }

  /**
   * Resolves the owner `userData` id for a user — needed to derive the shared advisory lock key.
   * Reads the FK from the DB; never from a possibly unloaded relation.
   */
  async resolveOwnerUserDataId(userId: number, manager?: EntityManager): Promise<number> {
    if (userId == null) {
      throw new BadRequestException('User id is required to resolve owner user data id');
    }

    const em = manager ?? this.custodyAccountRepo.manager;

    // camelCase column must stay quoted for Postgres.
    const row = await em
      .createQueryBuilder()
      .select('u."userDataId"', 'userDataId')
      .from(User, 'u')
      .where('u.id = :userId', { userId })
      .getRawOne<{ userDataId: number | string | null }>();

    if (!row) throw new NotFoundException('User not found');

    if (row.userDataId == null || row.userDataId === '') {
      throw new ConflictException(`User ${userId} has no userDataId`);
    }

    const id = Number(row.userDataId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new ConflictException(`Invalid userDataId value: ${String(row.userDataId)}`);
    }

    return id;
  }

  /**
   * Resolves the custody account that new orders/balances for this user must inherit.
   *
   * Reads `custodyAccountId` from the DB for the given user id — never from a possibly
   * unloaded `user.custodyAccount` relation. Callers that need an account on create must
   * use this helper (or {@link resolveAccountForNewCustodyUser}); reading the relation
   * directly reintroduces silent nulls whenever the relation was not loaded.
   *
   * When called inside a locked transaction, pass that transaction's `manager` so the read
   * uses the same connection that holds the advisory lock.
   *
   * @returns the materialised account, or `undefined` while the user is still in legacy mode
   */
  async resolveAccountForUser(userId: number, manager?: EntityManager): Promise<CustodyAccount | undefined> {
    if (userId == null) {
      throw new BadRequestException('User id is required to resolve custody account');
    }

    const em = manager ?? this.custodyAccountRepo.manager;

    // Select the FK column only — no dependency on relation loading at the call site.
    // camelCase column must stay quoted for Postgres.
    const row = await em
      .createQueryBuilder()
      .select('u."custodyAccountId"', 'custodyAccountId')
      .from(User, 'u')
      .where('u.id = :userId', { userId })
      .getRawOne<{ custodyAccountId: number | string | null }>();

    if (!row) throw new NotFoundException('User not found');

    return this.toAccountRef(row.custodyAccountId);
  }

  /**
   * Resolves the materialised Safe a newly created custody user under this owner should inherit.
   *
   * Queries existing custody siblings' `custodyAccountId` explicitly — never via nested
   * `users.custodyAccount` relations that callers may have left unloaded.
   *
   * When called inside a locked transaction, pass that transaction's `manager` so the read
   * uses the same connection that holds the advisory lock.
   *
   * @returns the first materialised sibling account, or `undefined` while fully in legacy mode
   */
  async resolveAccountForNewCustodyUser(
    ownerUserDataId: number,
    manager?: EntityManager,
  ): Promise<CustodyAccount | undefined> {
    if (ownerUserDataId == null) {
      throw new BadRequestException('Owner user data id is required to resolve custody account');
    }

    const em = manager ?? this.custodyAccountRepo.manager;

    // camelCase columns must stay quoted for Postgres.
    const row = await em
      .createQueryBuilder()
      .select('u."custodyAccountId"', 'custodyAccountId')
      .from(User, 'u')
      .where('u."userDataId" = :ownerUserDataId', { ownerUserDataId })
      .andWhere('u.role = :role', { role: UserRole.CUSTODY })
      .andWhere('u."custodyAccountId" IS NOT NULL')
      .orderBy('u.id', 'ASC')
      .limit(1)
      .getRawOne<{ custodyAccountId: number | string }>();

    return this.toAccountRef(row?.custodyAccountId);
  }

  /**
   * Builds a TypeORM relation stub from a raw FK value.
   * Null/undefined → legacy (no account). Non-numeric FK → fail closed (corrupt data).
   */
  private toAccountRef(custodyAccountId: number | string | null | undefined): CustodyAccount | undefined {
    if (custodyAccountId == null || custodyAccountId === '') return undefined;

    const id = Number(custodyAccountId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new ConflictException(`Invalid custodyAccountId value: ${String(custodyAccountId)}`);
    }

    // Relation stub is enough for TypeORM to persist the FK on create/save.
    return { id } as CustodyAccount;
  }
}
