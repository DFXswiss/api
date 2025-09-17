import { Injectable } from '@nestjs/common';
import { Config, Environment } from 'src/config/config';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CountryService } from '../country/country.service';
import { IpLog } from './ip-log.entity';
import { IpLogRepository } from './ip-log.repository';

@Injectable()
export class IpLogService {
  constructor(
    private readonly geoLocationService: GeoLocationService,
    private readonly countryService: CountryService,
    private readonly ipLogRepo: IpLogRepository,
    private readonly repos: RepositoryFactory,
  ) {}

  async create(ip: string, url: string, address: string): Promise<IpLog> {
    const { country, result, user } = await this.checkIpCountry(ip, address);
    const ipLog = this.ipLogRepo.create({
      ip,
      country,
      result,
      url,
      address,
      user,
    });

    return this.ipLogRepo.save(ipLog);
  }

  async getDistinctUserDataIpLogs(ip: string): Promise<IpLog[]> {
    return this.ipLogRepo
      .createQueryBuilder('ipLog')
      .select('ipLog')
      .leftJoinAndSelect('ipLog.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .where('ipLog.ip = :ip', { ip })
      .andWhere('ipLog.user.id IS NOT NULL')
      .distinctOn(['ipLog.user.userData.id'])
      .getMany();
  }

  private async checkIpCountry(
    userIp: string,
    address: string,
  ): Promise<{ country: string; result: boolean; user: User }> {
    if (Config.environment === Environment.LOC || userIp?.includes(Config.azureIpSubstring))
      return { country: 'INTERN', result: true, user: undefined };

    const country = this.geoLocationService.getCountry(userIp);
    const countryObject = await this.countryService.getCountryWithSymbol(country);

    const user = await this.repos.user.findOneBy({ address });

    if (!countryObject || (user && user.role != UserRole.USER)) return { country, result: true, user };

    return { country, result: countryObject?.ipEnable, user };
  }
}
