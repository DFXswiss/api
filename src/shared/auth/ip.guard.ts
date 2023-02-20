import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { IpRepository } from 'src/subdomains/generic/user/models/ip/ip.repository';
import { CountryService } from '../models/country/country.service';

@Injectable()
export class IpGuard implements CanActivate {
  constructor(
    private geoLocationService: GeoLocationService,
    private countryService: CountryService,
    private ipRepo: IpRepository,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    let userIp = context.switchToHttp().getRequest().ip;
    // ignore Azure private addresses
    if (userIp?.includes(Config.azureIpSubstring)) {
      return;
    }
    userIp = '77.185.19.137';
    const address = context.switchToHttp().getRequest().dto;
    const country = await this.checkIpCountry(userIp);

    const ipObject = this.ipRepo.create({
      ip: userIp,
      ipCountry: country.country,
      result: country.result,
      address,
    });
    await this.ipRepo.save(ipObject);
    return true;
  }

  private async checkIpCountry(userIp: string): Promise<{ result: boolean; country: string }> {
    const ipCountry = await this.geoLocationService.getCountry(userIp);

    const country = await this.countryService.getCountryWithSymbol(ipCountry);
    if (!country?.ipEnable && Config.environment !== 'loc')
      throw new ForbiddenException('The country of IP address is not allowed');

    return { country: ipCountry, result: country.ipEnable };
  }
}
