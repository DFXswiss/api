import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { hasStaffAccess } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';

export type HistorySubject = User | UserData;

export interface HistoryListCredentials {
  jwt?: JwtPayload;
  userAddress?: string;
  apiKey?: string;
  apiSign?: string;
  apiTimestamp?: string;
}

/**
 * Resolves who may load transaction history and whether a single-tx response may include
 * private fields. List/export endpoints require JWT or CT API-key auth; address filters are
 * ownership-checked against the authenticated subject (fail-closed).
 */
@Injectable()
export class HistoryAccessService {
  constructor(
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
  ) {}

  /**
   * Authenticate a history list/export call.
   * - Bearer JWT (account required) preferred
   * - else DFX-ACCESS-KEY + SIGN + TIMESTAMP (CoinTracking-style)
   * - `userAddress` is only a scope filter and must belong to the subject
   */
  async resolveListSubject(creds: HistoryListCredentials): Promise<HistorySubject> {
    if (creds.jwt?.account != null) {
      return this.resolveFromJwt(creds.jwt, creds.userAddress);
    }

    if (creds.apiKey && creds.apiSign && creds.apiTimestamp) {
      return this.resolveFromApiKey(creds.apiKey, creds.apiSign, creds.apiTimestamp, creds.userAddress);
    }

    throw new UnauthorizedException('Authentication required');
  }

  /**
   * Full (non-public) single-tx payload is allowed for the owner account or staff that
   * already has SUPPORT-or-higher access via the role hierarchy.
   */
  canViewFullTransaction(jwt: JwtPayload | undefined, tx: Transaction | TransactionRequest | undefined): boolean {
    if (!jwt?.role) return false;
    if (this.isStaffFullAccess(jwt)) return true;
    return this.isOwner(jwt, tx);
  }

  isOwner(jwt: JwtPayload | undefined, tx: Transaction | TransactionRequest | undefined): boolean {
    if (!jwt?.account || !tx) return false;
    const accountId = this.accountIdOf(tx);
    return accountId != null && accountId === jwt.account;
  }

  private isStaffFullAccess(jwt: JwtPayload): boolean {
    // DFX staff only: the SUPPORT hierarchy (COMPLIANCE / ADMIN / SUPER_ADMIN via hasStaffAccess). REALUNIT is an
    // isolated external tenant, NOT DFX staff — granting it ownership-independent full access here would leak every
    // customer's private banking/compliance data across the tenant boundary that its own routes scope via
    // RealUnitScopeService. RealUnit access to a customer's transaction must stay customer-scoped, never blanket.
    //
    // `hasStaffAccess`, not `hasRoleAccess`: these routes are OptionalJwtAuthGuard-only, so no RoleGuard has
    // applied the staff KYC gate. Ownership-independent access to every customer's history is exactly the
    // privilege the gate exists for.
    return hasStaffAccess(UserRole.SUPPORT, jwt);
  }

  private accountIdOf(tx: Transaction | TransactionRequest): number | undefined {
    // Duck-typed: Transaction has userData; TransactionRequest has user.userData (and sometimes both).
    const withUserData = tx as { userData?: { id?: number }; user?: { userData?: { id?: number } } };
    return withUserData.userData?.id ?? withUserData.user?.userData?.id;
  }

  private async resolveFromJwt(jwt: JwtPayload, userAddress?: string): Promise<HistorySubject> {
    const account = await this.userDataService.getUserData(jwt.account, { users: true });
    if (!account) throw new UnauthorizedException();

    const addressFilter = userAddress?.trim() || jwt.address?.trim();
    if (!addressFilter) {
      // Account token without address → full account history
      return account;
    }

    const owned = this.findOwnedUser(account, addressFilter);
    if (!owned) throw new ForbiddenException('Address does not belong to this account');

    owned.userData = account;
    return owned;
  }

  private async resolveFromApiKey(
    apiKey: string,
    apiSign: string,
    apiTimestamp: string,
    userAddress?: string,
  ): Promise<HistorySubject> {
    // User keys end with version digit `0` (see ApiKeyService / history.controller); account keys differ.
    if (apiKey.endsWith('0')) {
      const user = await this.userService.checkApiKey(apiKey, apiSign, apiTimestamp);
      if (userAddress?.trim() && !this.addressesEqual(user.address, userAddress.trim())) {
        throw new ForbiddenException('Address does not belong to this API key');
      }
      return user;
    }

    const userData = await this.userDataService.checkApiKey(apiKey, apiSign, apiTimestamp);
    if (!userAddress?.trim()) return userData;

    const filter = userAddress.trim();
    const users = userData.users?.length
      ? userData.users
      : (await this.userDataService.getUserData(userData.id, { users: true }))?.users;

    const owned = users?.find((u) => this.addressesEqual(u.address, filter));
    if (!owned) throw new ForbiddenException('Address does not belong to this API key');

    owned.userData = userData;
    return owned;
  }

  private findOwnedUser(account: UserData, address: string): User | undefined {
    return account.users?.find((u) => this.addressesEqual(u.address, address));
  }

  private addressesEqual(a?: string, b?: string): boolean {
    if (!a || !b) return false;
    return a.toLowerCase() === b.toLowerCase();
  }
}
