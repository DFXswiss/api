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
  
  @Injectable()
  export class PaymentService {
    constructor(private sellRepository: PaymentRepository) {}
    
    async createPayment(createPaymentDto: CreatePaymentDto): Promise<any>{
      return this.sellRepository.createPayment(createPaymentDto);
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