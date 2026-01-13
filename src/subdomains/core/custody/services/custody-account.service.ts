import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { CustodyAccountAccess } from '../entities/custody-account-access.entity';
import { CustodyAccount } from '../entities/custody-account.entity';
import { CustodyAccessLevel, CustodyAccountStatus } from '../enums/custody';
import { CustodyAccountAccessRepository } from '../repositories/custody-account-access.repository';
import { CustodyAccountRepository } from '../repositories/custody-account.repository';
import { CustodyBalanceRepository } from '../repositories/custody-balance.repository';

export interface CustodyAccountDto {
  id: number | null; // null for legacy mode
  title: string;
  description?: string;
  isLegacy: boolean;
  accessLevel: CustodyAccessLevel;
  owner?: { id: number };
}

@Injectable()
export class CustodyAccountService {
  constructor(
    private readonly custodyAccountRepo: CustodyAccountRepository,
    private readonly custodyAccountAccessRepo: CustodyAccountAccessRepository,
    private readonly userDataService: UserDataService,
    private readonly custodyBalanceRepo: CustodyBalanceRepository,
  ) {}

  // --- GET CUSTODY ACCOUNTS --- //
  async getCustodyAccountsForUser(accountId: number): Promise<CustodyAccountDto[]> {
    const account = await this.userDataService.getUserData(accountId, { users: true });
    if (!account) throw new NotFoundException('User not found');

    // 1. Check for explicit CustodyAccounts (owned or shared)
    const ownedAccounts = await this.custodyAccountRepo.find({
      where: { owner: { id: accountId }, status: CustodyAccountStatus.ACTIVE },
      relations: ['owner'],
    });

    const accessGrants = await this.custodyAccountAccessRepo.find({
      where: { userData: { id: accountId } },
      relations: ['custodyAccount', 'custodyAccount.owner'],
    });

    const sharedAccounts = accessGrants
      .filter((a) => a.custodyAccount.status === CustodyAccountStatus.ACTIVE)
      .filter((a) => a.custodyAccount.owner.id !== accountId); // exclude owned

    const custodyAccounts: CustodyAccountDto[] = [
      ...ownedAccounts.map((ca) => this.mapToDto(ca, CustodyAccessLevel.WRITE, false)),
      ...sharedAccounts.map((a) => this.mapToDto(a.custodyAccount, a.accessLevel, false)),
    ];

    if (custodyAccounts.length > 0) {
      return custodyAccounts;
    }

    // 2. Fallback: Aggregate all CUSTODY users as one "Legacy"
    const custodyUsers = account.users.filter((u) => u.role === UserRole.CUSTODY);
    if (custodyUsers.length > 0) {
      return [this.createLegacyDto(account)];
    }

    return [];
  }

  async getCustodyAccountById(custodyAccountId: number): Promise<CustodyAccount> {
    const custodyAccount = await this.custodyAccountRepo.findOne({
      where: { id: custodyAccountId },
      relations: ['owner', 'accessGrants', 'accessGrants.userData'],
    });

    if (!custodyAccount) throw new NotFoundException('CustodyAccount not found');

    return custodyAccount;
  }

  // --- ACCESS CHECK --- //
  async checkAccess(
    custodyAccountId: number | null,
    accountId: number,
    requiredLevel: CustodyAccessLevel,
  ): Promise<{ custodyAccount: CustodyAccount | null; isLegacy: boolean }> {
    // Legacy mode
    if (custodyAccountId === null) {
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
      throw new ForbiddenException('No access to this CustodyAccount');
    }

    // Check if access level is sufficient
    if (requiredLevel === CustodyAccessLevel.WRITE && access.accessLevel === CustodyAccessLevel.READ) {
      throw new ForbiddenException('Write access required');
    }

    return { custodyAccount, isLegacy: false };
  }

  // --- CREATE --- //
  async createCustodyAccount(
    accountId: number,
    title: string,
    description?: string,
  ): Promise<CustodyAccount> {
    const owner = await this.userDataService.getUserData(accountId);
    if (!owner) throw new NotFoundException('User not found');

    const custodyAccount = this.custodyAccountRepo.create({
      title,
      description,
      owner,
      status: CustodyAccountStatus.ACTIVE,
      requiredSignatures: 1,
    });

    const saved = await this.custodyAccountRepo.save(custodyAccount);

    // Create WRITE access for owner
    const ownerAccess = this.custodyAccountAccessRepo.create({
      custodyAccount: saved,
      userData: owner,
      accessLevel: CustodyAccessLevel.WRITE,
    });
    await this.custodyAccountAccessRepo.save(ownerAccess);

    return saved;
  }

  // --- UPDATE --- //
  async updateCustodyAccount(
    custodyAccountId: number,
    accountId: number,
    title?: string,
    description?: string,
  ): Promise<CustodyAccount> {
    const { custodyAccount } = await this.checkAccess(custodyAccountId, accountId, CustodyAccessLevel.WRITE);
    if (!custodyAccount) throw new ForbiddenException('Cannot update legacy account');

    if (title) custodyAccount.title = title;
    if (description !== undefined) custodyAccount.description = description;

    return this.custodyAccountRepo.save(custodyAccount);
  }

  // --- HELPERS --- //
  private mapToDto(custodyAccount: CustodyAccount, accessLevel: CustodyAccessLevel, isLegacy: boolean): CustodyAccountDto {
    return {
      id: custodyAccount.id,
      title: custodyAccount.title,
      description: custodyAccount.description,
      isLegacy,
      accessLevel,
      owner: custodyAccount.owner ? { id: custodyAccount.owner.id } : undefined,
    };
  }

  private createLegacyDto(userData: UserData): CustodyAccountDto {
    return {
      id: null,
      title: 'Custody', // Default title for legacy
      description: undefined,
      isLegacy: true,
      accessLevel: CustodyAccessLevel.WRITE, // Owner has full access
      owner: { id: userData.id },
    };
  }

  // --- GET ACCESS LIST --- //
  async getAccessList(custodyAccountId: number, accountId: number): Promise<CustodyAccountAccess[]> {
    await this.checkAccess(custodyAccountId, accountId, CustodyAccessLevel.READ);

    return this.custodyAccountAccessRepo.find({
      where: { custodyAccount: { id: custodyAccountId } },
      relations: ['userData'],
    });
  }
}
