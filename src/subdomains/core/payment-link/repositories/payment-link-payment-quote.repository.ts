import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { PaymentLinkPaymentQuote } from '../entities/payment-link-payment-quote.entity';

@Injectable()
export class PaymentLinkPaymentQuoteRepository extends BaseRepository<PaymentLinkPaymentQuote> {
  constructor(manager: EntityManager) {
    super(PaymentLinkPaymentQuote, manager);
  }
}
