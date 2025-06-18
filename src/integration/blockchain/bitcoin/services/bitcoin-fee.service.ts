import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';

@Injectable()
export class BitcoinFeeService {
  private readonly btcFeeUrl = 'https://mempool.space/api/v1/fees/recommended';

  constructor(private readonly http: HttpService) {}

  async getRecommendedFeeRate(): Promise<number> {
    const { fastestFee } = await this.http.get<{
      fastestFee: number;
      halfHourFee: number;
      hourFee: number;
      economyFee: number;
      minimumFee: number;
    }>(this.btcFeeUrl, {
      tryCount: 3,
    });

    return fastestFee;
  }
}
