import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';

@Injectable()
export class JwtOrPaymentLinkKeyGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = request.query['key'];

    return Boolean(key) || this.validateJwt(context);
  }

  private async validateJwt(context: ExecutionContext): Promise<boolean> {
    const isAuthenticated = await new OptionalJwtAuthGuard().canActivate(context);
    if (!isAuthenticated) return false;

    const hasRole = await RoleGuard(UserRole.USER).canActivate(context);
    if (!hasRole) return false;

    return UserActiveGuard().canActivate(context);
  }
}
