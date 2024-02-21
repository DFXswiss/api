import { BadRequestException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HistoryFilter, HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Util } from '../utils/util';

@Injectable()
export class ApiKeyService {
  private versionLength = 1;
  private filterLength = 3;

  private filterCodes: { [k in keyof HistoryFilter]: number } = {
    buy: 0,
    sell: 1,
    staking: 2,
    ref: 3,
    lm: 4,
  };

  // --- SECRET HANDLING --- //
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

  // --- KEY HANDLING --- //
  public createKey(address: string): string {
    const hash = Util.createHash(Util.createHash(address + new Date().toISOString(), 'sha256'), 'md5').toUpperCase();
    return hash.substring(0, hash.length - this.versionLength) + Config.apiKeyVersionCT;
  }

  public getFilter(filterCode?: string): HistoryFilter {
    return filterCode ? this.codeToFilter(filterCode) : undefined;
  }

  public getFilterArray(filterCode?: string): HistoryFilterKey[] {
    return filterCode
      ? Object.entries(this.getFilter(filterCode))
          .filter(([_, value]) => value)
          .map(([key, _]) => key as HistoryFilterKey)
      : undefined;
  }

  public getFilterCode(filter: HistoryFilter): string {
    return this.filterToCode(filter);
  }

  // --- HELPER METHODS --- //
  private codeToFilter(filterCode: string): HistoryFilter {
    const filter = parseInt(filterCode, 16);
    return Object.entries(this.filterCodes)
      .filter(([_, value]) => filter & Math.pow(2, value))
      .reduce((prev, [key, _]) => Object.assign(prev, { [key]: true }), new HistoryFilter());
  }

  private filterToCode(filter: HistoryFilter): string {
    const filterCode = Util.sum(Object.keys(filter).map((key) => Math.pow(2, this.filterCodes[key])));
    return filterCode.toString(16).padStart(this.filterLength, '0');
  }
}
