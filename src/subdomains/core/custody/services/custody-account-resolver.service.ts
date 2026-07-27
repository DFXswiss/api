import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CustodyAccount } from '../entities/custody-account.entity';
import { CustodyAccountRepository } from '../repositories/custody-account.repository';

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
   * Resolves the custody account that new orders/balances for this user must inherit.
   *
   * Reads `custodyAccountId` from the DB for the given user id — never from a possibly
   * unloaded `user.custodyAccount` relation. Callers that need an account on create must
   * use this helper (or {@link resolveAccountForNewCustodyUser}); reading the relation
   * directly reintroduces silent nulls whenever the relation was not loaded.
   *
   * @returns the materialised account, or `undefined` while the user is still in legacy mode
   */
  async resolveAccountForUser(userId: number): Promise<CustodyAccount | undefined> {
    if (userId == null) {
      throw new BadRequestException('User id is required to resolve custody account');
    }

    // Select the FK column only — no dependency on relation loading at the call site.
    // camelCase column must stay quoted for Postgres.
    const row = await this.custodyAccountRepo.manager
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
   * @returns the first materialised sibling account, or `undefined` while fully in legacy mode
   */
  async resolveAccountForNewCustodyUser(ownerUserDataId: number): Promise<CustodyAccount | undefined> {
    if (ownerUserDataId == null) {
      throw new BadRequestException('Owner user data id is required to resolve custody account');
    }

    // camelCase columns must stay quoted for Postgres.
    const row = await this.custodyAccountRepo.manager
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
