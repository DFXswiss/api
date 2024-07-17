import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager, Equal } from 'typeorm';
import { PaymentLinkPaymentStatus } from '../dto/payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';

@Injectable()
export class PaymentLinkPaymentRepository extends BaseRepository<PaymentLinkPayment> {
  constructor(manager: EntityManager) {
    super(PaymentLinkPayment, manager);
  }

  async getPayment(
    userId: number,
    linkOrExternalId: string,
    status: PaymentLinkPaymentStatus,
  ): Promise<PaymentLinkPayment | null> {
    return this.findOne({
      where: [
        {
          link: { id: Equal(+linkOrExternalId), route: { user: { id: userId } } },
          status,
        },
        {
          link: { externalId: Equal(linkOrExternalId), route: { user: { id: userId } } },
          status,
        },
      ],
      relations: { link: { route: true, payments: { currency: true } } },
    });
  }
}
