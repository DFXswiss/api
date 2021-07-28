import {
    BadRequestException,
    Injectable,
    NotFoundException,
  } from '@nestjs/common';
  import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
  import { Repository } from 'typeorm';
  import { CreatePaymentDto } from './dto/create-payment.dto';
  import { UpdatePaymentDto } from './dto/update-payment.dto';
  import { Payment } from './payment.entity';
  import { PaymentRepository } from 'src/payment/payment.repository';
  import { CreateBuyPaymentDto } from './dto/create-buy-payment.dto';
  import { CreateSellPaymentDto } from './dto/create-sell-payment.dto';
  
  @Injectable()
  export class PaymentService {
    constructor(private sellRepository: PaymentRepository) {}
    
    async createPayment(createPaymentDto: CreatePaymentDto): Promise<any>{
      return this.sellRepository.createPayment(createPaymentDto);
    }

    async createBuyPayment(createPaymentDto: CreateBuyPaymentDto): Promise<any>{
      return this.sellRepository.createBuyPayment(createPaymentDto);
    }

    async createSellPayment(createPaymentDto: CreateSellPaymentDto): Promise<any>{
      return this.sellRepository.createSellPayment(createPaymentDto);
    }
  
    async getPayment(id: any): Promise<any> {
      return this.sellRepository.getPayment(id);
    }
  
    async getAllPayment(): Promise<any> {
      return this.sellRepository.getAllPayment();
    }
  
    async updatePayment(updatePaymentDto: UpdatePaymentDto): Promise<any> {
      return this.sellRepository.updatePayment(updatePaymentDto);
    }

    async getUnprocessedPayment(): Promise<any> {
        return this.sellRepository.getUnprocessedPayment();
    }

  }