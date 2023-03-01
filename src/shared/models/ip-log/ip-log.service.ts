import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { Util } from 'src/shared/utils/util';
import { Like, MoreThan } from 'typeorm';
import { CountryService } from '../country/country.service';
import { IpLog } from './ip-log.entity';
import { IpLogRepository } from './ip-log.repository';

@Injectable()
export class IpLogService {
  constructor(
    private geoLocationService: GeoLocationService,
    private countryService: CountryService,
    private ipLogRepo: IpLogRepository,
  ) {}

  async create(ip: string, url: string, address: string): Promise<IpLog> {
    const { country, result } = await this.checkIpCountry(ip);
    const ipLog = this.ipLogRepo.create({
      ip,
      country,
      result,
      url,
      address,
    });
    return this.ipLogRepo.save(ipLog);
  }

  async checkRateLimit(url: string, ip: string): Promise<boolean> {
    if (!Config.request.limitCheck || Config.request.knownIps.includes(ip)) return true;
    const callLimit = this.getUrlLimit(url);
    if (!callLimit) return true;
    const ipWithoutLastElement = ip.split('.').slice(0, -1).join('.');
    const callCount = await this.getCallCount(url, ipWithoutLastElement);
    return callLimit > callCount;
  }

  private async checkIpCountry(userIp: string): Promise<{ country: string; result: boolean }> {
    if (Config.environment === 'loc' || userIp?.includes(Config.azureIpSubstring))
      return { country: 'INTERN', result: true };
    const country = await this.geoLocationService.getCountry(userIp);
    if (!country) return { country, result: false };
    const countryObject = await this.countryService.getCountryWithSymbol(country);

    return { country, result: countryObject?.ipEnable };
  }

  async getCallCount(url: string, ip: string): Promise<number> {
    return this.ipLogRepo.count({
      url,
      ip: Like(`${ip}%`),
      created: MoreThan(Util.daysBefore(1)),
    });
  }

  private getUrlLimit(url: string): number | undefined {
    switch (url) {
      case '/v1/auth/signUp':
        return 20;
      case '/v1/statistic/transactions':
        return 24;
      default:
        return undefined;
    }
  }
}
