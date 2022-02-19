import { Injectable } from '@nestjs/common';
import { HttpService } from './http.service';

export interface DfiTaxReward {
  value: number;
  category: string;
  date: string;
  detail: {
    token: string;
    qty: number;
    pool: string;
  };
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

  async getRewards(address: string, interval: string): Promise<DfiTaxReward[]> {
    const url = `${this.baseUrl}/p01/rwd/${address}/${interval}/EUR`;
    return await this.http.get<DfiTaxReward[]>(url);
  }

  async getTransactions(address: string, interval: string): Promise<DfiTaxTransaction[]> {
    const url = `${this.baseUrl}/v01/hst/${address}/${interval}/EUR`;
    return await this.http.get<DfiTaxTransaction[]>(url);
  }
}
