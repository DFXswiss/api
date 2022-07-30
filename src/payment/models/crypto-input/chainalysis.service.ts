import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { Blockchain } from '../deposit/deposit.entity';

enum Rating {
  LOW_RISK = 'lowRisk',
  HIGH_RISK = 'highRisk',
  UNKNOWN = 'unknown',
}

interface Transfer {
  transferReference: string;
  asset: number;
  cluster: { name: string; category: string };
  rating: Rating;
}

@Injectable()
export class ChainalysisService {
  private readonly baseUrl = 'https://api.chainalysis.com/api/kyt/v1/users';

  constructor(private readonly http: HttpService) {}

  async isHighRiskTx(
    userDataId: number,
    txId: string,
    vout: number,
    asset: string,
    blockchain: Blockchain,
  ): Promise<boolean> {
    const data = [
      {
        network: blockchain,
        asset: asset,
        transferReference: `${txId}:${vout}`,
      },
    ];
    const transferResponse = await this.callApi<Transfer[]>(`${userDataId}/transfers/received`, 'POST', data);

    return transferResponse[0].rating === Rating.HIGH_RISK;
  }

  // --- HELPER METHODS --- //
  private async callApi<T>(url: string, method: Method = 'GET', data?: any): Promise<T> {
    return this.request<T>(url, method, data).catch((e: HttpError) => {
      throw new ServiceUnavailableException(e);
    });
  }

  private async request<T>(url: string, method: Method, data?: any, nthTry = 3): Promise<T> {
    try {
      return await this.http.request<T>({
        url: `${this.baseUrl}/${url}`,
        method: method,
        data: data,
        headers: {
          Token: Config.chainalysis.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
    } catch (e) {
      if (nthTry > 1) {
        return this.request(url, method, data, nthTry - 1);
      }
      throw e;
    }
  }
}
