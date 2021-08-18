import { Injectable } from '@nestjs/common';
import { BuyRepository } from 'src/buy/buy.repository';

@Injectable()
export class StatisticService {
  constructor(private buyRepository: BuyRepository) {}

  async getBuyCount(): Promise<any> {
    return this.buyRepository.getBuyCount();
  }
}
