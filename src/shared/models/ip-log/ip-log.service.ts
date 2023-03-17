import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { CountryService } from '../country/country.service';
import { IpLog } from './ip-log.entity';
import { IpLogRepository } from './ip-log.repository';

@Injectable()
export class IpLogService {
  constructor(
    private geoLocationService: GeoLocationService,
    private countryService: CountryService,
    private ipLogRepo: IpLogRepository,
    private userService: UserService,
  ) {}

  async create(ip: string, url: string, address: string): Promise<IpLog> {
    const { country, result } = await this.checkIpCountry(ip, address);
    const ipLog = this.ipLogRepo.create({
      ip,
      country,
      result,
      url,
      address,
    });

    return this.ipLogRepo.save(ipLog);
  }

  private async checkIpCountry(userIp: string, address: string): Promise<{ country: string; result: boolean }> {
    if (Config.environment === 'loc' || userIp?.includes(Config.azureIpSubstring))
      return { country: 'INTERN', result: true };
    const country = await this.geoLocationService.getCountry(userIp);
    const user = await this.userService.getUserByAddress(address);

    if (!country || user?.role != UserRole.USER) return { country, result: true };
    const countryObject = await this.countryService.getCountryWithSymbol(country);

    return { country, result: countryObject?.ipEnable };
  }
}
