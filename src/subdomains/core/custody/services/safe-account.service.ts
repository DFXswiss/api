import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { In } from 'typeorm';
import { SafeAccountAccess } from '../entities/safe-account-access.entity';
import { SafeAccount } from '../entities/safe-account.entity';
import { SafeAccessLevel, SafeAccountStatus } from '../enums/custody';
import { SafeAccountAccessRepository } from '../repositories/safe-account-access.repository';
import { SafeAccountRepository } from '../repositories/safe-account.repository';
import { CustodyBalanceRepository } from '../repositories/custody-balance.repository';

export interface SafeAccountDto {
  id: number | null; // null for legacy mode
  title: string;
  description?: string;
  isLegacy: boolean;
  accessLevel: SafeAccessLevel;
  owner?: { id: number };
}

@Injectable()
export class SafeAccountService {
  constructor(
    private readonly safeAccountRepo: SafeAccountRepository,
    private readonly safeAccountAccessRepo: SafeAccountAccessRepository,
    private readonly userDataService: UserDataService,
    private readonly custodyBalanceRepo: CustodyBalanceRepository,
  ) {}

  // --- GET SAFE ACCOUNTS --- //
  async getSafeAccountsForUser(accountId: number): Promise<SafeAccountDto[]> {
    const account = await this.userDataService.getUserData(accountId, { users: true });
    if (!account) throw new NotFoundException('User not found');

    // 1. Check for explicit SafeAccounts (owned or shared)
    const ownedAccounts = await this.safeAccountRepo.find({
      where: { owner: { id: accountId }, status: SafeAccountStatus.ACTIVE },
      relations: ['owner'],
    });

    const accessGrants = await this.safeAccountAccessRepo.find({
      where: { userData: { id: accountId } },
      relations: ['safeAccount', 'safeAccount.owner'],
    });

    const sharedAccounts = accessGrants
      .filter((a) => a.safeAccount.status === SafeAccountStatus.ACTIVE)
      .filter((a) => a.safeAccount.owner.id !== accountId); // exclude owned

    const safeAccounts: SafeAccountDto[] = [
      ...ownedAccounts.map((sa) => this.mapToDto(sa, SafeAccessLevel.WRITE, false)),
      ...sharedAccounts.map((a) => this.mapToDto(a.safeAccount, a.accessLevel, false)),
    ];

    if (safeAccounts.length > 0) {
      return safeAccounts;
    }

    // 2. Fallback: Aggregate all CUSTODY users as one "Legacy Safe"
    const custodyUsers = account.users.filter((u) => u.role === UserRole.CUSTODY);
    if (custodyUsers.length > 0) {
      return [this.createLegacySafeDto(account)];
    }

    return [];
  }

  async getSafeAccountById(safeAccountId: number): Promise<SafeAccount> {
    const safeAccount = await this.safeAccountRepo.findOne({
      where: { id: safeAccountId },
      relations: ['owner', 'accessGrants', 'accessGrants.userData'],
    });

    if (!safeAccount) throw new NotFoundException('SafeAccount not found');

    return safeAccount;
  }

  // --- ACCESS CHECK --- //
  async checkAccess(
    safeAccountId: number | null,
    accountId: number,
    requiredLevel: SafeAccessLevel,
  ): Promise<{ safeAccount: SafeAccount | null; isLegacy: boolean }> {
    // Legacy mode
    if (safeAccountId === null) {
      return { safeAccount: null, isLegacy: true };
    }

    const safeAccount = await this.getSafeAccountById(safeAccountId);

    // Owner has WRITE access
    if (safeAccount.owner.id === accountId) {
      return { safeAccount, isLegacy: false };
    }

    // Check access grants
    const access = safeAccount.accessGrants.find((a) => a.userData.id === accountId);
    if (!access) {
      throw new ForbiddenException('No access to this SafeAccount');
    }

    // Check if access level is sufficient
    if (requiredLevel === SafeAccessLevel.WRITE && access.accessLevel === SafeAccessLevel.READ) {
      throw new ForbiddenException('Write access required');
    }

    return { safeAccount, isLegacy: false };
  }

  // --- CREATE --- //
  async createSafeAccount(
    accountId: number,
    title: string,
    description?: string,
  ): Promise<SafeAccount> {
    const owner = await this.userDataService.getUserData(accountId);
    if (!owner) throw new NotFoundException('User not found');

    const safeAccount = this.safeAccountRepo.create({
      title,
      description,
      owner,
      status: SafeAccountStatus.ACTIVE,
      requiredSignatures: 1,
    });

    const saved = await this.safeAccountRepo.save(safeAccount);

    // Create WRITE access for owner
    const ownerAccess = this.safeAccountAccessRepo.create({
      safeAccount: saved,
      userData: owner,
      accessLevel: SafeAccessLevel.WRITE,
    });
    await this.safeAccountAccessRepo.save(ownerAccess);

    return saved;
  }

  // --- UPDATE --- //
  async updateSafeAccount(
    safeAccountId: number,
    accountId: number,
    title?: string,
    description?: string,
  ): Promise<SafeAccount> {
    const { safeAccount } = await this.checkAccess(safeAccountId, accountId, SafeAccessLevel.WRITE);
    if (!safeAccount) throw new ForbiddenException('Cannot update legacy safe');

    if (title) safeAccount.title = title;
    if (description !== undefined) safeAccount.description = description;

    return this.safeAccountRepo.save(safeAccount);
  }

  // --- HELPERS --- //
  private mapToDto(safeAccount: SafeAccount, accessLevel: SafeAccessLevel, isLegacy: boolean): SafeAccountDto {
    return {
      id: safeAccount.id,
      title: safeAccount.title,
      description: safeAccount.description,
      isLegacy,
      accessLevel,
      owner: safeAccount.owner ? { id: safeAccount.owner.id } : undefined,
    };
  }

  private createLegacySafeDto(userData: UserData): SafeAccountDto {
    return {
      id: null,
      title: 'Safe', // Default title for legacy
      description: undefined,
      isLegacy: true,
      accessLevel: SafeAccessLevel.WRITE, // Owner has full access
      owner: { id: userData.id },
    };
  }

  // --- GET ACCESS LIST --- //
  async getAccessList(safeAccountId: number, accountId: number): Promise<SafeAccountAccess[]> {
    await this.checkAccess(safeAccountId, accountId, SafeAccessLevel.READ);

    return this.safeAccountAccessRepo.find({
      where: { safeAccount: { id: safeAccountId } },
      relations: ['userData'],
    });
  }
}
