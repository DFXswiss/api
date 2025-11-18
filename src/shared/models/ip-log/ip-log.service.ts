import { Injectable } from '@nestjs/common';
import { Config, Environment } from 'src/config/config';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { WalletType } from 'src/subdomains/generic/user/models/user/user.enum';
import { FindOptionsWhere, IsNull, LessThanOrEqual, MoreThan } from 'typeorm';
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

  private readonly idCache = new AsyncCache<IpLog>(CacheItemResetPeriod.EVERY_6_MONTH);

  async create(ip: string, url: string, address: string, walletType?: WalletType, userData?: UserData): Promise<IpLog> {
    const { country, result, user } = await this.checkIpCountry(ip, address);
    const ipLog = this.ipLogRepo.create({
      ip,
      country,
      result,
      url,
      address,
      user,
      userData: userData ?? user.userData,
      walletType,
    });

    return this.ipLogRepo.save(ipLog);
  }

  async getLoginCountries(userDataId: number, dateFrom: Date, dateTo = new Date()): Promise<string[]> {
    const nearestLog = await this.idCache.get(Util.isoDate(dateFrom), () =>
      this.ipLogRepo.findOne({ where: { created: LessThanOrEqual(dateFrom) }, order: { id: 'DESC' } }),
    );

    return this.ipLogRepo
      .createQueryBuilder('log')
      .select('log.country', 'country')
      .distinct()
      .where('log.id >= :id', { id: nearestLog.id })
      .andWhere('log.created BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .andWhere('log.userDataId = :userDataId', { userDataId })
      .andWhere('log.country IS NOT NULL')
      .getRawMany<{ country: string }>()
      .then((ipLogs) => ipLogs.map((i) => i.country));
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

  async updateUserIpLogs(user: User): Promise<void> {
    const dateFrom = Util.daysBefore(180);
    const nearestLog = await this.idCache.get(Util.isoDate(dateFrom), () =>
      this.ipLogRepo.findOne({ where: { created: LessThanOrEqual(dateFrom) }, order: { id: 'DESC' } }),
    );

    const request: FindOptionsWhere<IpLog> = { id: MoreThan(nearestLog.id), address: user.address };

    await this.ipLogRepo.update(
      [
        { ...request, user: IsNull() },
        { ...request, userData: IsNull() },
      ],
      { user, userData: user.userData },
    );
  }

  private async checkIpCountry(
    userIp: string,
    address: string,
  ): Promise<{ country: string; result: boolean; user: User }> {
    if (Config.environment === Environment.LOC || userIp?.includes(Config.azureIpSubstring))
      return { country: 'INTERN', result: true, user: undefined };

    const country = this.geoLocationService.getCountry(userIp);
    const countryObject = await this.countryService.getCountryWithSymbol(country);

    const user = await this.repos.user.findOne({ where: { address }, relations: { userData: true } });

    if (!countryObject || (user && user.role != UserRole.USER)) return { country, result: true, user };

    return { country, result: countryObject?.ipEnable, user };
  }
}
