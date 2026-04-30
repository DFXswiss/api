import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { CustodyAccessLevel } from '../enums/custody';
import { CustodyAccountId, CustodyAccountService, LegacyAccountId } from '../services/custody-account.service';

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
      throw new ForbiddenException(error.message || 'Access denied');
    }
  }

  private getCustodyAccountId(request: any): CustodyAccountId {
    const id = request.params?.custodyAccountId || request.params?.id;
    if (id == null) throw new ForbiddenException('Custody account ID required');

    if (id === LegacyAccountId) return id;

    const parsed = +id;
    if (isNaN(parsed)) throw new ForbiddenException('Invalid custody account ID');

    return parsed;
  }
}

@Injectable()
export class CustodyAccountReadGuard extends CustodyAccountAccessGuard {
  protected readonly requiredLevel = CustodyAccessLevel.READ;
}

@Injectable()
export class CustodyAccountWriteGuard extends CustodyAccountAccessGuard {
  protected readonly requiredLevel = CustodyAccessLevel.WRITE;
}
