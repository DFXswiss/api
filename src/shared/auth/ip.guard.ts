import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { getClientIp } from '@supercharge/request-ip';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { IpLogService } from '../models/ip-log/ip-log.service';
import { UserRole } from './user-role.enum';

@Injectable()
export class IpGuard implements CanActivate {
  constructor(private ipLogService: IpLogService, private userService: UserService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = getClientIp(req);

    const ipLog = await this.ipLogService.create(ip, req.url, req.body.address);
    const user = await this.userService.getUserByKey('address', req.body.address);
    if (user?.role != UserRole.USER) return true;

    if (!ipLog.result) throw new ForbiddenException('The country of IP address is not allowed');

    return ipLog.result;
  }
}
