import { Injectable } from '@nestjs/common';
import { Config, Environment } from 'src/config/config';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { WalletType } from 'src/subdomains/generic/user/models/user/user.enum';
import { Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
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

  private readonly last24hLogCache = new AsyncCache<IpLog>(CacheItemResetPeriod.EVERY_24_HOURS);

  async create(ip: string, url: string, address: string, walletType?: WalletType): Promise<IpLog> {
    const { country, result, user } = await this.checkIpCountry(ip, address);
    const ipLog = this.ipLogRepo.create({
      ip,
      country,
      result,
      url,
      address,
      user,
      walletType,
    });

    return this.ipLogRepo.save(ipLog);
  }

  async getLogsByUserData(userDataId: number, dateFrom: Date, dateTo = new Date()): Promise<IpLog[]> {
    const nearestLog = await this.last24hLogCache.get('nearestLog', () =>
      this.ipLogRepo.findOne({ where: { created: LessThanOrEqual(dateFrom) }, order: { id: 'DESC' } }),
    );

    return this.ipLogRepo.findBy({
      id: MoreThanOrEqual(nearestLog.id),
      created: Between(dateFrom, dateTo),
      user: { userData: { id: userDataId } },
    });
  }

  async getUserDataIdsWith(ip: string): Promise<number[]> {
    const addressLogUserDataIds = await this.ipLogRepo
      .createQueryBuilder('ipLog')
      .select('userData.id', 'id')
      .distinct()
      .innerJoin(User, 'user', 'ipLog.address=user.address')
      .innerJoin('user.userData', 'userData')
      .where('ipLog.ip = :ip', { ip })
      .andWhere('(userData.hasIpRisk = 0 OR userData.hasIpRisk IS NULL)')
      .getRawMany<{ id: number }>()
      .then((u) => u.map((userData) => userData.id));

    const mailLogUserDataIds = await this.ipLogRepo
      .createQueryBuilder('ipLog')
      .select('userData.id', 'id')
      .distinct()
      .innerJoin(UserData, 'userData', 'ipLog.address=userData.mail')
      .where('ipLog.ip = :ip', { ip })
      .andWhere(`ipLog.address LIKE '%@%'`)
      .andWhere('(userData.hasIpRisk = 0 OR userData.hasIpRisk IS NULL)')
      .getRawMany<{ id: number }>()
      .then((u) => u.map((userData) => userData.id));

    return [...addressLogUserDataIds, ...mailLogUserDataIds];
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
