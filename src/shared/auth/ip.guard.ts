import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { getClientIp } from '@supercharge/request-ip';

@Injectable()
export class IpGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = getClientIp(req);

    if (ip !== req.user?.ip) throw new UnauthorizedException('IP is not matching token IP');

    return true;
  }
}
