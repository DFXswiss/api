import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from '../../../../shared/services/http.service';
import { Util } from '../../../../shared/utils/util';

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
  private readonly logger = new DfxLogger(DfiTaxService);

  private readonly baseUrl = 'https://api.dfi.tax';

  constructor(private readonly http: HttpService) {}

  activateAddress(address: string): void {
    this.getRewards(address, DfiTaxInterval.YEAR, new Date(0), new Date(), 1200000).catch((e) =>
      this.logger.warn(`Failed to activate address ${address} for DFI.tax:`, e),
    );
  }

  async getRewards(
    address: string,
    interval: string,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
    timeout = 15000,
  ): Promise<DfiTaxReward[]> {
    // ignore today's rewards
    const yesterday = Util.daysBefore(1);
    yesterday.setHours(23, 59, 59, 999);
    dateTo = new Date(Math.min(dateTo.getTime(), yesterday.getTime()));

    dateFrom.setHours(0, 0, 0, 0);

    const url = `${this.baseUrl}/p01/rwd/${address}/${interval}/EUR`;

    try {
      const rewards = await this.http.get<DfiTaxReward[]>(url, { timeout: timeout, tryCount: 3 });

      return rewards.filter((item) => {
        return new Date(item.date).getTime() >= dateFrom.getTime() && new Date(item.date).getTime() <= dateTo.getTime();
      });
    } catch (e) {
      throw new ServiceUnavailableException(e);
    }
  }

  async getTransactions(
    address: string,
    interval: string,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<DfiTaxTransaction[]> {
    const url = `${this.baseUrl}/v01/hst/${address}/${interval}/EUR`;

    try {
      const rewards = await this.http.get<DfiTaxTransaction[]>(url, { timeout: 15000, tryCount: 3 });

      return rewards.filter((item: any) => {
        return item.date.getTime() >= dateFrom.getTime() && item.date.getTime() <= dateTo.getTime();
      });
    } catch (e) {
      throw new ServiceUnavailableException(e);
    }
  }
}
