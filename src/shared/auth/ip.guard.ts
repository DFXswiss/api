import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { IpRepository } from 'src/subdomains/generic/user/models/ip/ip.repository';
import { CountryService } from '../models/country/country.service';
import * as requestIp from '@supercharge/request-ip';

@Injectable()
export class IpGuard implements CanActivate {
  constructor(
    private geoLocationService: GeoLocationService,
    private countryService: CountryService,
    private ipRepo: IpRepository,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ip = await requestIp.getClientIp(context.switchToHttp().getRequest());
    const { country, result } = await this.checkIpCountry(ip);
    const address = context.switchToHttp().getRequest().body.address;

    const ipObject = this.ipRepo.create({
      ip,
      country,
      result,
      address,
    });
    await this.ipRepo.save(ipObject);
    if (!result) throw new ForbiddenException('The country of IP address is not allowed');
    return result;
  }

  private async checkIpCountry(userIp: string): Promise<{ country: string; result: boolean }> {
    if (Config.environment === 'loc' || userIp?.includes(Config.azureIpSubstring))
      return { country: 'INTERN', result: true };
    const country = await this.geoLocationService.getCountry(userIp);
    if (!country) throw new ForbiddenException('The country of IP address is unknown');
    const countryObject = await this.countryService.getCountryWithSymbol(country);

    return { country, result: countryObject?.ipEnable };
  }
}
