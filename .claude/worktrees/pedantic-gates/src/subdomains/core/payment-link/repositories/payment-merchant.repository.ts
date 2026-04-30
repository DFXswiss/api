import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { PaymentMerchant } from '../entities/payment-merchant.entity';

@Injectable()
export class PaymentMerchantRepository extends BaseRepository<PaymentMerchant> {
  constructor(manager: EntityManager) {
    super(PaymentMerchant, manager);
  }
}
