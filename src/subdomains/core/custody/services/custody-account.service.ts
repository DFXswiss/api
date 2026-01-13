import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { CustodyAccountDto } from '../dto/output/custody-account.dto';
import { CustodyAccountAccess } from '../entities/custody-account-access.entity';
import { CustodyAccount } from '../entities/custody-account.entity';
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
      custodyAccountAccesses: { account: { owner: true } },
    });
    if (!account) throw new NotFoundException('User not found');

    // owned accounts (via direct ownership)
    const ownedAccounts = await this.custodyAccountRepo.find({
      where: { owner: { id: accountId }, status: CustodyAccountStatus.ACTIVE },
      relations: { owner: true },
    });

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
      account: saved,
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
}
