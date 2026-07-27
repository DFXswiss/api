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
      custodyAccountAccesses: { account: { owner: true } },
    });
    if (!account) throw new NotFoundException('User not found');

    // owned accounts
    const ownedAccounts = (account.custodyAccounts ?? []).filter((ca) => ca.status === CustodyAccountStatus.ACTIVE);

    // shared accounts (via access grants, excluding owned)
    const sharedAccounts = (account.custodyAccountAccesses ?? [])
      .filter((a) => a.account.status === CustodyAccountStatus.ACTIVE)
      .filter((a) => a.account.owner.id !== accountId);

    const custodyAccounts: CustodyAccountDto[] = [
      ...ownedAccounts.map((ca) => CustodyAccountDtoMapper.toDto(ca, CustodyAccessLevel.WRITE)),
      ...sharedAccounts.map((a) => CustodyAccountDtoMapper.toDto(a.account, a.accessLevel)),
    ];

    if (custodyAccounts.length > 0) {
      return custodyAccounts;
    }

    // fallback to legacy custody account
    const hasCustody = account.users.some((u) => u.role === UserRole.CUSTODY);
    if (hasCustody) {
      return [CustodyAccountDtoMapper.toLegacyDto(account)];
    }

    return [];
  }

  async getCustodyAccountById(custodyAccountId: number): Promise<CustodyAccount> {
    const custodyAccount = await this.custodyAccountRepo.findOne({
      where: { id: custodyAccountId },
      relations: { owner: true, accessGrants: { userData: true } },
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

    // Check access grants
    const access = custodyAccount.accessGrants.find((a) => a.userData.id === accountId);
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
      where: { account: { id: custodyAccountId } },
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

    const target = await this.resolveUserByMail(mail);
    if (target.id === ownerAccountId) {
      throw new BadRequestException('Cannot grant access to yourself');
    }

    if (custodyAccountId === LegacyAccountId) {
      return this.grantAccessForLegacy(ownerAccountId, target, accessLevel);
    }

    const account = await this.requireOwner(custodyAccountId, ownerAccountId);
    return this.createGrant(this.custodyAccountAccessRepo.manager, account, target, accessLevel);
  }

  async updateAccess(
    custodyAccountId: number,
    accessId: number,
    ownerAccountId: number,
    accessLevel: CustodyAccessLevel,
  ): Promise<CustodyAccountAccess> {
    await this.requireOwner(custodyAccountId, ownerAccountId);

    const access = await this.getAccessGrantForAccount(custodyAccountId, accessId);
    access.accessLevel = accessLevel;

    return this.custodyAccountAccessRepo.save(access);
  }

  async revokeAccess(custodyAccountId: number, accessId: number, ownerAccountId: number): Promise<void> {
    await this.requireOwner(custodyAccountId, ownerAccountId);

    const access = await this.getAccessGrantForAccount(custodyAccountId, accessId);
    await this.custodyAccountAccessRepo.remove(access);
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

  private async getAccessGrantForAccount(custodyAccountId: number, accessId: number): Promise<CustodyAccountAccess> {
    const access = await this.custodyAccountAccessRepo.findOne({
      where: { id: accessId },
      relations: { userData: true, account: true },
    });
    if (!access || access.account.id !== custodyAccountId) {
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
      where: { account: { id: account.id }, userData: { id: target.id } },
    });
    if (existing) {
      throw new ConflictException('Access grant already exists for this user');
    }

    const grant = manager.create(CustodyAccountAccess, {
      account,
      userData: target,
      accessLevel,
    });

    return manager.save(grant);
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
    });
    await manager.save(ownerAccess);

    return saved;
  }

  private async grantAccessForLegacy(
    ownerAccountId: number,
    target: UserData,
    accessLevel: CustodyAccessLevel,
  ): Promise<CustodyAccountAccess> {
    const owner = await this.userDataService.getActiveUserData(ownerAccountId, { users: true });
    const hasCustody = owner.users.some((u) => u.role === UserRole.CUSTODY);
    if (!hasCustody) {
      throw new NotFoundException('Legacy account not found');
    }

    return this.custodyAccountRepo.manager.transaction(async (manager) => {
      // Serialize concurrent materialisations for the same owner
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `custody-legacy-materialize:${ownerAccountId}`,
      ]);

      const existingAccounts = await manager.find(CustodyAccount, {
        where: { owner: { id: ownerAccountId }, status: CustodyAccountStatus.ACTIVE },
        relations: { owner: true },
        order: { id: 'ASC' },
      });

      let account: CustodyAccount;
      if (existingAccounts.length > 0) {
        account = existingAccounts[0];
      } else {
        account = await this.persistCustodyAccount(manager, owner, 'Custody');
        await this.attachLegacyCustodyData(manager, account, owner);
      }

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
    await manager
      .createQueryBuilder()
      .update(CustodyBalance)
      .set({ account })
      .where('"userId" IN (:...userIds)', { userIds: custodyUserIds })
      .execute();

    await manager
      .createQueryBuilder()
      .update(CustodyOrder)
      .set({ account })
      .where('"userId" IN (:...userIds)', { userIds: custodyUserIds })
      .execute();
  }
}
