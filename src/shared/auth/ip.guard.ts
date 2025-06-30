import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { getClientIp } from '@supercharge/request-ip';
import { DfxLogger } from '../../logger/dfx-logger.service';

@Injectable()
export class IpGuard implements CanActivate {
  private readonly logger = new DfxLogger(IpGuard);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = getClientIp(req);

    // TODO: switch back
    if (ip !== req.user?.ip) this.logger.verbose(`IP mismatch for user ${req.user?.id}`);
    // if (ip !== req.user?.ip) throw new UnauthorizedException('IP is not matching token IP');

    return true;
  }
}
