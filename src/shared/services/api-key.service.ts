import { BadRequestException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HistoryFilter } from 'src/payment/models/history/dto/history-filter.dto';
import { HistoryQuery } from 'src/payment/models/history/dto/history-query.dto';
import { User } from 'src/user/models/user/user.entity';
import { Util } from '../util';

export enum HistoryFilterCode {
  buy = '0',
  sell = '1',
  staking = '2',
  ref = '3',
  lm = '4',
}

@Injectable()
export class ApiKeyService {
  constructor() {}

  public createKey(address: string, queryFilter: HistoryFilter): string {
    let hash = Util.createHash(Util.createHash(address + new Date().toISOString(), 'sha256'), 'md5').toUpperCase();

    return hash.substring(0, hash.length - 4) + this.getFilterCode(queryFilter) + Config.apiKeyVersionCT;
  }

  public getSecret(user: User): string {
    if (!user.apiKeyCT) throw new BadRequestException('API key is null');
    return Util.createHash(user.apiKeyCT + user.created, 'sha256').toUpperCase();
  }

  public getSign(user: User, timestamp: string): string {
    const secret = this.getSecret(user);
    return Util.createHash(secret + timestamp, 'sha256').toUpperCase();
  }

  public isValidSign(user: User, sign: string, timestamp: string): boolean {
    const userSign = this.getSign(user, timestamp);

    return sign.toUpperCase() == userSign && Util.daysDiff(new Date(timestamp), new Date()) <= 1;
  }

  public getActiveFilter(apiKey: string, filter: HistoryQuery): HistoryFilter {
    const apiKeyFilter = parseInt(apiKey.substring(apiKey.length - 5, apiKey.length - 1), 16);
    const apiKeyVersion = apiKey.substring(apiKey.length - 1, apiKey.length);

    if (apiKeyVersion == '0') {
      return;
    } else if (apiKeyVersion == '1') {
      Object.entries(HistoryFilterCode).map(
        ([key, value]) =>
          (filter[key] =
            (apiKeyFilter & Math.pow(2, Number(value))) > 0
              ? ((apiKeyFilter & Math.pow(2, Number(value))) > 0).toString()
              : filter[key] != null
              ? filter[key]
              : null),
      );

      return filter;
    }
  }

  private getFilterCode(queryFilter: HistoryFilter): string {
    const filterCode = Util.sum(Object.keys(queryFilter).map((key) => Math.pow(2, HistoryFilterCode[key])));
    return filterCode.toString(16).padStart(3, '0');
  }
}
