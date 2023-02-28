import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { IpLogRepository } from 'src/subdomains/generic/user/models/ip-log/ip-log.repository';
import { CountryService } from '../models/country/country.service';
import { getClientIp } from '@supercharge/request-ip';
import { Like, MoreThan } from 'typeorm';
import { Util } from '../utils/util';

@Injectable()
export class IpGuard implements CanActivate {
  constructor(
    private geoLocationService: GeoLocationService,
    private countryService: CountryService,
    private ipLogRepo: IpLogRepository,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = getClientIp(req);

    const callLimit = this.getUrlLimit(req.url);

    if (callLimit > 0 && !Config.knownRequestIps.includes(ip)) {
      const ipWithoutLastElement = ip.split('.').slice(0, -1).join('.');
      const callCount = await this.ipLogRepo.count({
        url: req.url,
        ip: Like(`${ipWithoutLastElement}%`),
        created: MoreThan(Util.daysBefore(1)),
      });
      if (callCount > callLimit) throw new HttpException(`Too many requests ${req.url}`, 429);
    }

    const { country, result } = await this.checkIpCountry(ip);
    const address = req.body.address;

    const ipLog = this.ipLogRepo.create({
      ip,
      country,
      result,
      url: req.url,
      address,
    });
    await this.ipLogRepo.save(ipLog);
    if (!result) throw new ForbiddenException('The country of IP address is not allowed');
    return result;
  }

  private async checkIpCountry(userIp: string): Promise<{ country: string; result: boolean }> {
    if (Config.environment === 'loc' || userIp?.includes(Config.azureIpSubstring))
      return { country: 'INTERN', result: true };
    const country = await this.geoLocationService.getCountry(userIp);
    if (!country) return { country, result: false };
    const countryObject = await this.countryService.getCountryWithSymbol(country);

    return { country, result: countryObject?.ipEnable };
  }

  private getUrlLimit(url: string): number {
    switch (url) {
      case '/v1/auth/signUp':
        return 20;
      case '/v1/statistic/transactions':
        return 24;
      default:
        return 0;
    }
  }
}
