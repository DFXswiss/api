import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager, Equal } from 'typeorm';
import { PaymentLink } from '../entities/payment-link.entity';

@Injectable()
export class PaymentLinkRepository extends BaseRepository<PaymentLink> {
  constructor(manager: EntityManager) {
    super(PaymentLink, manager);
  }

  async getAllPaymentLinks(userId: number): Promise<PaymentLink[]> {
    return this.find({ where: { route: { user: { id: userId } } }, relations: { route: true } });
  }

  async getPaymentLinkById(userId: number, id: number): Promise<PaymentLink | null> {
    return this.findOne({
      where: { id: Equal(id), route: { user: { id: Equal(userId) } } },
      relations: { route: true },
    });
  }

  async getPaymentLinkByExternalId(userId: number, externalId: string): Promise<PaymentLink | null> {
    return this.findOne({
      where: { externalId: Equal(externalId), route: { user: { id: Equal(userId) } } },
      relations: { route: true },
    });
  }
}
