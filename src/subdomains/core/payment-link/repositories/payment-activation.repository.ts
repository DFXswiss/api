import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { PaymentActivation } from '../entities/payment-activation.entity';

@Injectable()
export class PaymentActivationRepository extends BaseRepository<PaymentActivation> {
  constructor(manager: EntityManager) {
    super(PaymentActivation, manager);
  }
}
