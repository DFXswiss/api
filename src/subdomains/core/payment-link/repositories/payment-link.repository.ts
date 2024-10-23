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
    return this.find({
      where: { route: { user: { id: Equal(userId) }, active: true } },
      relations: { route: { user: { userData: true } } },
    });
  }

  async getPaymentLinkById(
    userId: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
  ): Promise<PaymentLink | null> {
    if (linkId) return this.getPaymentLinkByLinkId(userId, linkId);
    if (externalLinkId) return this.getPaymentLinkByExternalId(userId, externalLinkId);
    if (externalPaymentId) return this.getPaymentLinkByExternalPaymentId(userId, externalPaymentId);

    return null;
  }

  private async getPaymentLinkByLinkId(userId: number, linkId: number): Promise<PaymentLink | null> {
    return this.findOne({
      where: { id: Equal(linkId), route: { user: { id: Equal(userId) }, active: true } },
      relations: { route: { user: { userData: true } } },
    });
  }

  private async getPaymentLinkByExternalId(userId: number, externalLinkId: string): Promise<PaymentLink | null> {
    return this.findOne({
      where: { externalId: Equal(externalLinkId), route: { user: { id: Equal(userId) }, active: true } },
      relations: { route: { user: { userData: true } } },
    });
  }

  private async getPaymentLinkByExternalPaymentId(
    userId: number,
    externalPaymentId: string,
  ): Promise<PaymentLink | null> {
    return this.findOne({
      where: {
        payments: { externalId: Equal(externalPaymentId) },
        route: { user: { id: Equal(userId) }, active: true },
      },
      relations: { route: { user: { userData: true } } },
    });
  }
}
