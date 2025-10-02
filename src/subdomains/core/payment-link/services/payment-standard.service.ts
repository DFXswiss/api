import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { PaymentStandardDto, PaymentStandardType } from '../dto/payment-standard.dto';

@Injectable()
export class PaymentStandardService {
  getAll(): PaymentStandardDto[] {
    return Config.payment.standards;
  }

  getById(id: PaymentStandardType): PaymentStandardDto {
    const standard = Config.payment.standards.find((s) => s.id === id);
    if (!standard) throw new NotFoundException('Payment standard not found');
    return standard;
  }
}
