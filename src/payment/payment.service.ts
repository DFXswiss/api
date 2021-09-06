import { Injectable } from '@nestjs/common';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { SellPaymentRepository } from 'src/payment/payment-sell.repository';
import { BuyPaymentRepository } from 'src/payment/payment-buy.repository';
import { CreateBuyPaymentDto } from './dto/create-buy-payment.dto';
import { CreateSellPaymentDto } from './dto/create-sell-payment.dto';
import { MailService } from 'src/mail/mail.service';

@Injectable()
export class PaymentService {
  constructor(
    private sellRepository: SellPaymentRepository,
    private buyRepository: BuyPaymentRepository,
    private mailService: MailService,
  ) {}

  async createBuyPayment(createPaymentDto: CreateBuyPaymentDto): Promise<any> {
    return this.buyRepository.createPayment(createPaymentDto,this.mailService);
  }

  async createSellPayment(
    createPaymentDto: CreateSellPaymentDto,
  ): Promise<any> {
    return this.sellRepository.createPayment(createPaymentDto);
  }

  async getBuyPayment(id: any): Promise<any> {
    return this.buyRepository.getPayment(id);
  }

  async getSellPayment(id: any): Promise<any> {
    return this.sellRepository.getPayment(id);
  }

  async getAllBuyPayment(): Promise<any> {
    return this.buyRepository.getAllPayment();
  }

  async getAllSellPayment(): Promise<any> {
    return this.sellRepository.getAllPayment();
  }

  async updateBuyPayment(updatePaymentDto: UpdatePaymentDto): Promise<any> {
    return this.buyRepository.updatePayment(updatePaymentDto,this.mailService);
  }

  async updateSellPayment(updatePaymentDto: UpdatePaymentDto): Promise<any> {
    return this.sellRepository.updatePayment(updatePaymentDto);
  }

  async getUnprocessedBuyPayment(): Promise<any> {
    return this.buyRepository.getUnprocessedPayment();
  }

  async getUnprocessedAcceptedBuyPayment(): Promise<any> {
    return this.buyRepository.getUnprocessedAcceptedPayment();
  }

  async getUnprocessedSellPayment(): Promise<any> {
    return this.sellRepository.getUnprocessedPayment();
  }
}
