import { Injectable } from '@nestjs/common';
import { BuyRepository } from 'src/buy/buy.repository';
import { SellRepository } from 'src/sell/sell.repository';
import { LogRepository } from 'src/log/log.repository';

@Injectable()
export class StatisticService {
  constructor(
    private buyRepository: BuyRepository,
    private sellRepository: SellRepository,
    private logRepository: LogRepository,
  ) {}

  async getBuyRouteCount(): Promise<number> {
    return this.buyRepository.count();
  }

  async getSellRouteCount(): Promise<number> {
    return this.sellRepository.count();
  }

  async getRouteCount(): Promise<any> {
    return {
      buy: await this.getBuyRouteCount(),
      sell: await this.getSellRouteCount(),
    };
  }

  async getDFIBuyVolume(): Promise<any> {
    return this.logRepository.getBuyDFIVolume();
  }

  async getDFISellVolume(): Promise<any> {
    return this.logRepository.getSellDFIVolume();
  }

  async getDFIVolume(): Promise<any> {
    return this.logRepository.getDFIVolume();
  }

  async getCHFVolume(): Promise<any> {
    return this.logRepository.getCHFVolume();
  }

  async getAll(): Promise<any> {
    return {
      dfxStatistic: {
        routes: await this.getRouteCount(),
        volume: { DFI: await this.getDFIVolume(), CHF: await this.getCHFVolume() },
      },
    };
  }
}
