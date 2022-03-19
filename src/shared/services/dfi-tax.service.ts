import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from './http.service';

export interface DfiTaxReward {
  value_open: number;
  category: string;
  date: string;
  token: string;
  qty: number;
  pool: string;
}

export interface DfiTaxTransaction {
  blk_id: number;
  value: number;
  tx_id: string;
  dt: string;
  cat: string;
  tokens: [
    {
      code: string;
      qty: number;
      value?: number;
    },
  ];
}

export enum DfiTaxInterval {
  YEAR = 'YEAR',
  MONTH = 'MONTH',
  WEEK = 'WEEK',
  DAY = 'DAY',
}

@Injectable()
export class DfiTaxService {
  private readonly baseUrl = 'https://api.dfi.tax';

  constructor(private readonly http: HttpService) {}

  activateAddress(address: string): void {
    this.getRewards(address, DfiTaxInterval.YEAR);
  }

  async getRewards(
    address: string,
    interval: string,
    dateFrom: Date = new Date('15 Aug 2021 00:00:00 GMT'),
    dateTo: Date = new Date(),
  ): Promise<DfiTaxReward[]> {
    const url = `${this.baseUrl}/p01/rwd/${address}/${interval}/EUR`;

    try {
      const rewards = await this.http.get<DfiTaxReward[]>(url, { timeout: 15000, tryCount: 3 });

      return rewards.filter((item: DfiTaxReward) => {
        return new Date(item.date).getTime() >= dateFrom.getTime() && new Date(item.date).getTime() <= dateTo.getTime();
      });
    } catch (error) {
      throw new ServiceUnavailableException(error);
    }
  }

  async getTransactions(
    address: string,
    interval: string,
    dateFrom: Date = new Date('15 Aug 2021 00:00:00 GMT'),
    dateTo: Date = new Date(),
  ): Promise<DfiTaxTransaction[]> {
    const url = `${this.baseUrl}/v01/hst/${address}/${interval}/EUR`;

    try {
      const rewards = await this.http.get<DfiTaxTransaction[]>(url, { timeout: 15000, tryCount: 3 });

      return rewards.filter((item: any) => {
        return item.date.getTime() >= dateFrom.getTime() && item.date.getTime() <= dateTo.getTime();
      });
    } catch (error) {
      throw new ServiceUnavailableException(error);
    }
  }
}
