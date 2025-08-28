import { Injectable } from '@nestjs/common';
import { CreatePaymentMerchantDto } from '../dto/create-payment-merchant.dto';
import { PaymentMerchant } from '../entities/payment-merchant.entity';
import { PaymentMerchantStatus } from '../enums';
import { PaymentMerchantRepository } from '../repositories/payment-merchant.repository';

@Injectable()
export class PaymentMerchantService {
  constructor(private readonly paymentMerchantRepo: PaymentMerchantRepository) {}

  async create(userId: number, dto: CreatePaymentMerchantDto): Promise<PaymentMerchant> {
    const merchant = this.paymentMerchantRepo.create({
      ...dto,
      status: PaymentMerchantStatus.CREATED,
      user: { id: userId },
    });

    return this.paymentMerchantRepo.save(merchant);
  }
}
