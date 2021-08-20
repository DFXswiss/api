import { Injectable } from '@nestjs/common';
import { BuyRepository } from 'src/buy/buy.repository';
import { SellRepository } from 'src/sell/sell.repository';
import { BuyPaymentRepository } from 'src/payment/payment-buy.repository';

@Injectable()
export class StatisticService {
  constructor(
    private buyRepository: BuyRepository,
    private sellRepository: SellRepository,
    private paymentBuyRepository: BuyPaymentRepository,
  ) {}

  async getBuyCount(): Promise<any> {
    return this.buyRepository.getBuyCount();
  }

  async getSellCount(): Promise<any> {
    return this.sellRepository.getSellCount();
  }

  async getPaymentValues(): Promise<any> {
    return this.paymentBuyRepository.getProcessedPaymentValue();
  }

  async getAll(): Promise<any> {
    const buyCount = await this.buyRepository.getBuyCount();
    const sellCount = await this.sellRepository.getSellCount();
    const paymentValues =
      await this.paymentBuyRepository.getProcessedPaymentValue();
    return [buyCount, sellCount, paymentValues];
  }
}
