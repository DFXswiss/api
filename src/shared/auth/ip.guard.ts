import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { CountryService } from '../models/country/country.service';
import { getClientIp } from '@supercharge/request-ip';
import { IpLogService } from '../models/ip-log/ip-log.service';

@Injectable()
export class IpGuard implements CanActivate {
  constructor(
    private geoLocationService: GeoLocationService,
    private countryService: CountryService,
    private ipLogService: IpLogService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = getClientIp(req);

    await this.ipLogService.checkRateLimit(req.url, ip);

    const { country, result } = await this.checkIpCountry(ip);
    const address = req.body.address;

    await this.ipLogService.create(ip, country, result, req.url, address);

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
}
