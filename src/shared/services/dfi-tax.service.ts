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

@Injectable()
export class DfiTaxService {
  private readonly baseUrl = 'https://api.dfi.tax';

  constructor(private readonly http: HttpService) {}

  activateAddress(userAddress: string): void {
    this.getRewards(userAddress, 'YEAR');
  }

  async getRewards(userAddress: string, interval: string): Promise<DfiTaxReward[]> {
    const url = `${this.baseUrl}/p01/rwd/${userAddress}/${interval}/EUR`;
    return await this.http.get<DfiTaxReward[]>(url);
  }

  async getTransactions(userAddress: string, year: string): Promise<DfiTaxTransaction[]> {
    const url = `${this.baseUrl}/v01/hst/${userAddress}/${year}/EUR`;
    return await this.http.get<DfiTaxTransaction[]>(url);
  }
}
