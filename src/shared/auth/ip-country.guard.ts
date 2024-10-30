import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { getClientIp } from '@supercharge/request-ip';
import { IpLogService } from '../models/ip-log/ip-log.service';

@Injectable()
export class IpCountryGuard implements CanActivate {
  constructor(private ipLogService: IpLogService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = getClientIp(req);

    const ipLog = await this.ipLogService.create(ip, req.url, req.body?.address ?? req.user.address, req.user);
    if (!ipLog.result) throw new ForbiddenException('The country of IP address is not allowed');

    return ipLog.result;
  }
}
