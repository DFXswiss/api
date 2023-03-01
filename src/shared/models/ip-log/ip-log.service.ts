import { HttpException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { Like, MoreThan } from 'typeorm';
import { IpLogRepository } from './ip-log.repository';

@Injectable()
export class IpLogService {
  constructor(private ipLogRepo: IpLogRepository) {}

  async getCallCount(url: string, ip: string): Promise<number> {
    return this.ipLogRepo.count({
      url,
      ip: Like(`${ip}%`),
      created: MoreThan(Util.daysBefore(1)),
    });
  }

  async create(ip: string, country: string, result: boolean, url: string, address: string): Promise<void> {
    const ipLog = this.ipLogRepo.create({
      ip,
      country,
      result,
      url,
      address,
    });
    await this.ipLogRepo.save(ipLog);
  }

  async checkRateLimit(url: string, ip: string): Promise<void> {
    const callLimit = this.getUrlLimit(url);
    if (callLimit > 0 && !Config.knownRequestIps.includes(ip)) {
      const ipWithoutLastElement = ip.split('.').slice(0, -1).join('.');
      const callCount = await this.getCallCount(url, ipWithoutLastElement);
      if (callCount > callLimit) throw new HttpException(`Too many requests ${url}`, 429);
    }
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
