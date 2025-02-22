import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { getClientIp } from '@supercharge/request-ip';
import { Config } from 'src/config/config';
import { IpLogService } from '../models/ip-log/ip-log.service';

@Injectable()
export class IpCountryGuard implements CanActivate {
  constructor(private ipLogService: IpLogService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = getClientIp(req);

    const ipLog = await this.ipLogService.create(ip, req.url, req.body?.address ?? req.user?.address);
    if (!ipLog.result) throw new ForbiddenException('The country of IP address is not allowed');

    const region = +req.body?.region;
    if (!isNaN(region) && !Config.loginCountries[region]?.includes(ipLog.country))
      throw new ForbiddenException('The country of IP address is not allowed');

    return ipLog.result;
  }
}
