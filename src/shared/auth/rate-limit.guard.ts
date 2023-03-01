import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { getClientIp } from '@supercharge/request-ip';
import { IpLogService } from '../models/ip-log/ip-log.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private ipLogService: IpLogService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = getClientIp(req);

    const checkRateLimit = await this.ipLogService.checkRateLimit(req.url, ip);
    if (!checkRateLimit) throw new HttpException(`Too many requests on endpoint ${req.url}`, 429);
    return checkRateLimit;
  }
}
