import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { CustodyAccessLevel } from '../enums/custody';
import { CustodyAccountService } from '../services/custody-account.service';

@Injectable()
export class CustodyAccountReadGuard implements CanActivate {
  constructor(private readonly custodyAccountService: CustodyAccountService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const accountId = request.user?.account;
    const custodyAccountId = this.getCustodyAccountId(request);

    if (!accountId) {
      throw new ForbiddenException('User not authenticated');
    }

    try {
      await this.custodyAccountService.checkAccess(custodyAccountId, accountId, CustodyAccessLevel.READ);
      return true;
    } catch (error) {
      throw new ForbiddenException(error.message || 'Access denied');
    }
  }

  private getCustodyAccountId(request: any): number | null {
    const id = request.params?.custodyAccountId || request.params?.id;
    if (id === 'legacy' || id === null || id === undefined) {
      return null;
    }
    return parseInt(id, 10);
  }
}

@Injectable()
export class CustodyAccountWriteGuard implements CanActivate {
  constructor(private readonly custodyAccountService: CustodyAccountService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const accountId = request.user?.account;
    const custodyAccountId = this.getCustodyAccountId(request);

    if (!accountId) {
      throw new ForbiddenException('User not authenticated');
    }

    try {
      await this.custodyAccountService.checkAccess(custodyAccountId, accountId, CustodyAccessLevel.WRITE);
      return true;
    } catch (error) {
      throw new ForbiddenException(error.message || 'Access denied');
    }
  }

  private getCustodyAccountId(request: any): number | null {
    const id = request.params?.custodyAccountId || request.params?.id;
    if (id === 'legacy' || id === null || id === undefined) {
      return null;
    }
    return parseInt(id, 10);
  }
}
