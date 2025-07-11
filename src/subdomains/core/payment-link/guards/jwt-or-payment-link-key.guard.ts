import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtUserActiveGuard } from 'src/shared/auth/jwt-user-active.guard';

@Injectable()
export class JwtOrPaymentLinkKeyGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = request.query['key'];

    return Boolean(key) || JwtUserActiveGuard().canActivate(context);
  }
}
