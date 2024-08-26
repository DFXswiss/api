import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { PaymentQuote } from '../entities/payment-quote.entity';

@Injectable()
export class PaymentQuoteRepository extends BaseRepository<PaymentQuote> {
  constructor(manager: EntityManager) {
    super(PaymentQuote, manager);
  }
}
