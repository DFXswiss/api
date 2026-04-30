import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';

@Injectable()
export class PaymentLinkPaymentRepository extends BaseRepository<PaymentLinkPayment> {
  constructor(manager: EntityManager) {
    super(PaymentLinkPayment, manager);
  }
}
