import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { PaymentStandardDto } from '../dto/payment-standard.dto';
import { PaymentStandard } from '../enums';

@Injectable()
export class PaymentStandardService {
  getAll(): PaymentStandardDto[] {
    return Config.payment.standards;
  }

  getById(id: PaymentStandard): PaymentStandardDto {
    const standard = Config.payment.standards.find((s) => s.id === id);
    if (!standard) throw new NotFoundException('Payment standard not found');
    return standard;
  }
}
