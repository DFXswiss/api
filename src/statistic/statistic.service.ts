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

  async getBuyOrder(): Promise<any> {
    return this.buyRepository.getBuyOrder();
  }

  async getSellOrder(): Promise<any> {
    return this.sellRepository.getSellOrder();
  }

  async getOrder(): Promise<any> {
    return {
      totalOrder: [await this.getBuyOrder(), await this.getSellOrder()],
    };
  }

  async getBuyVolume(): Promise<any> {
    return this.logRepository.getBuyVolume();
  }

  async getSellVolume(): Promise<any> {
    return this.logRepository.getSellVolume();
  }

  async getVolume(): Promise<any> {
    return this.logRepository.getVolume();
  }
  async getAll(): Promise<any> {
    return { dfxStatistic: [await this.getOrder(), await this.getVolume()] };
  }
}
