import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { PaymentLink } from '../entities/payment-link.entity';

@Injectable()
export class PaymentLinkRepository extends BaseRepository<PaymentLink> {
  constructor(manager: EntityManager) {
    super(PaymentLink, manager);
  }
}
