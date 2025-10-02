import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStandardDto, PaymentStandardType } from '../dto/payment-standard.dto';
import { PAYMENT_STANDARDS } from '../config/payment-standards.config';

@Injectable()
export class PaymentStandardService {
  getAll(): PaymentStandardDto[] {
    return PAYMENT_STANDARDS;
  }

  getById(id: PaymentStandardType): PaymentStandardDto {
    const standard = PAYMENT_STANDARDS.find((s) => s.id === id);
    if (!standard) throw new NotFoundException('Payment standard not found');
    return standard;
  }
}
