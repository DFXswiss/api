import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { CustodyAccessLevel } from '../enums/custody';
import {
  CustodyAccountId,
  CustodyAccountService,
  LegacyAccountId,
  PG_INTEGER_MAX,
} from '../services/custody-account.service';

abstract class CustodyAccountAccessGuard implements CanActivate {
  protected abstract readonly requiredLevel: CustodyAccessLevel;

  constructor(protected readonly custodyAccountService: CustodyAccountService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const accountId = request.user?.account;
    if (!accountId) {
      throw new ForbiddenException('User not authenticated');
    }

    try {
      const custodyAccountId = this.getCustodyAccountId(request);
      await this.custodyAccountService.checkAccess(custodyAccountId, accountId, this.requiredLevel);
      return true;
    } catch (error) {
      // Only translate HTTP errors (e.g. 404 from checkAccess) into 403 to prevent account
      // enumeration. Programming errors must surface as 500, not look like access denied.
      if (error instanceof HttpException) {
        throw new ForbiddenException(error.message || 'Access denied');
      }
      throw error;
    }
  }

  private getCustodyAccountId(request: { params?: Record<string, string | undefined> }): CustodyAccountId {
    const id = request.params?.custodyAccountId || request.params?.id;
    if (id == null) throw new ForbiddenException('Custody account ID required');

    if (id === LegacyAccountId) return id;

    // Same constraints as the controller: digits only, finite safe positive int in SERIAL range.
    // (Guards map validation failures to 403; the controller answers 400 on grant routes.)
    if (!/^\d+$/.test(id)) {
      throw new ForbiddenException('Invalid custody account ID');
    }

    const parsed = Number(id);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > PG_INTEGER_MAX) {
      throw new ForbiddenException('Invalid custody account ID');
    }

    return parsed;
  }
}

@Injectable()
export class CustodyAccountReadGuard extends CustodyAccountAccessGuard {
  protected readonly requiredLevel = CustodyAccessLevel.READ;

  constructor(custodyAccountService: CustodyAccountService) {
    super(custodyAccountService);
  }
}

@Injectable()
export class CustodyAccountWriteGuard extends CustodyAccountAccessGuard {
  protected readonly requiredLevel = CustodyAccessLevel.WRITE;

  constructor(custodyAccountService: CustodyAccountService) {
    super(custodyAccountService);
  }
}
