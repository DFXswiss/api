import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { Config } from 'src/config/config';
import { IpLogService } from '../models/ip-log/ip-log.service';

@Injectable()
export class IpCountryGuard implements CanActivate {
  constructor(private ipLogService: IpLogService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = req.realIp;

    const address = req.body?.address ?? req.user?.address;
    if (!address) throw new BadRequestException('Address is required');

    // WHY: guards run before validation pipes, so @Transform(Util.sanitize) on DTOs does not protect this path
    const rawWallet: string | undefined = req.body?.wallet;
    const walletName = rawWallet?.trim()
      ? sanitizeHtml(rawWallet.trim(), {
          allowedTags: [],
          allowedAttributes: {},
          disallowedTagsMode: 'escape',
        }).replace(/&amp;/g, '&')
      : rawWallet;
    const ipLog = await this.ipLogService.create(ip, req.url, address, req.body?.walletType, walletName);
    if (!ipLog.result) throw new ForbiddenException('The country of IP address is not allowed');

    const region = +req.body?.region;
    if (!isNaN(region) && !Config.loginCountries[region]?.includes(ipLog.country))
      throw new ForbiddenException('The country of IP address is not allowed');

    return ipLog.result;
  }
}
