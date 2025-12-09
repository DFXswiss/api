import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { SafeAccessLevel } from '../enums/custody';
import { SafeAccountService } from '../services/safe-account.service';

@Injectable()
export class SafeAccountReadGuard implements CanActivate {
  constructor(private readonly safeAccountService: SafeAccountService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const accountId = request.user?.account;
    const safeAccountId = this.getSafeAccountId(request);

    if (!accountId) {
      throw new ForbiddenException('User not authenticated');
    }

    try {
      await this.safeAccountService.checkAccess(safeAccountId, accountId, SafeAccessLevel.READ);
      return true;
    } catch (error) {
      throw new ForbiddenException(error.message || 'Access denied');
    }
  }

  private getSafeAccountId(request: any): number | null {
    const id = request.params?.safeAccountId || request.params?.id;
    if (id === 'legacy' || id === null || id === undefined) {
      return null;
    }
    return parseInt(id, 10);
  }
}

@Injectable()
export class SafeAccountWriteGuard implements CanActivate {
  constructor(private readonly safeAccountService: SafeAccountService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const accountId = request.user?.account;
    const safeAccountId = this.getSafeAccountId(request);

    if (!accountId) {
      throw new ForbiddenException('User not authenticated');
    }

    try {
      await this.safeAccountService.checkAccess(safeAccountId, accountId, SafeAccessLevel.WRITE);
      return true;
    } catch (error) {
      throw new ForbiddenException(error.message || 'Access denied');
    }
  }

  private getSafeAccountId(request: any): number | null {
    const id = request.params?.safeAccountId || request.params?.id;
    if (id === 'legacy' || id === null || id === undefined) {
      return null;
    }
    return parseInt(id, 10);
  }
}
