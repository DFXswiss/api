import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager, Equal } from 'typeorm';
import { PaymentLink } from '../entities/payment-link.entity';

@Injectable()
export class PaymentLinkRepository extends BaseRepository<PaymentLink> {
  constructor(manager: EntityManager) {
    super(PaymentLink, manager);
  }

  async getPaymentLink(userId: number, idOrExternalId: string): Promise<PaymentLink | null> {
    return this.findOne({
      where: [
        { id: Equal(+idOrExternalId), route: { user: { id: Equal(userId) } } },
        { externalId: Equal(idOrExternalId), route: { user: { id: Equal(userId) } } },
      ],
      relations: { route: true },
    });
  }
}
