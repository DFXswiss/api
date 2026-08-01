import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { Between, EntityManager, Equal, In } from 'typeorm';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkPaymentStatus } from '../enums';

/**
 * What `PUT /paymentLink/:id/pos` reads: a URL built from `uniqueId` and one access key, taken from
 * the link's configuration, the account's, or the two merged.
 *
 * `accountType` is deliberately NOT selected: `UserData.address` switches to the organization row
 * for an organization account and would dereference a relation this query has no reason to join.
 */
export const POS_LINK_RESPONSE_FIELDS = [
  'paymentLink.uniqueId',
  'paymentLink.config',
  'posUserData.paymentLinksConfig',
];

/**
 * `PUT /paymentLink/:id/pos` — the access keys, and the ids that carry the joins.
 *
 * The endpoint writes, but through `update(id, …)` on the link and on the account rather than by
 * saving either row back, so a projected read cannot blank a column it did not load. `config` and
 * `paymentLinksConfig` are in the projection for the write as much as for the answer: it merges the
 * new key into whichever of them applies, and a configuration the query failed to load would be a
 * configuration silently reset.
 */
export const POS_LINK_PROJECTION = new ReadProjection<PaymentLink>(
  'paymentLink',
  [
    ['paymentLink.route', 'posRoute'],
    ['posRoute.user', 'posUser'],
    ['posUser.userData', 'posUserData'],
  ],
  POS_LINK_RESPONSE_FIELDS,
  // Never part of the answer: the primary keys that make the ORM materialise the joined rows, and
  // the two ids the two updates are scoped by.
  ['paymentLink.id', 'posRoute.id', 'posUser.id', 'posUserData.id'],
);

@Injectable()
export class PaymentLinkRepository extends BaseRepository<PaymentLink> {
  constructor(manager: EntityManager) {
    super(PaymentLink, manager);
  }

  /**
   * One link, carrying what a point-of-sale link is built from.
   *
   * `fields` is what the mutation test in `pos-link.projection.spec.ts` re-runs the query with;
   * `PaymentLinkService.createPosLinkAdmin` calls this without it.
   */
  async findForPosLink(
    id: number,
    fields: ReadonlyArray<string> = POS_LINK_PROJECTION.fields,
  ): Promise<PaymentLink | null> {
    return POS_LINK_PROJECTION.apply(this.createQueryBuilder('paymentLink'), fields)
      .where('paymentLink.id = :id', { id })
      .getOne();
  }

  async getAllPaymentLinks(userId: number): Promise<PaymentLink[]> {
    return this.find({
      where: { route: { user: { id: Equal(userId) }, active: true } },
      relations: { route: { user: { userData: { organization: true } } } },
    });
  }

  async getAllPaymentLinksByExternalLinkId(externalLinkId: string): Promise<PaymentLink[]> {
    return this.find({
      where: { externalId: Equal(externalLinkId) },
      relations: { route: { user: { userData: { organization: true } } } },
    });
  }

  async getAllPaymentLinksByExternalPaymentId(externalPaymentId: string): Promise<PaymentLink[]> {
    return this.find({
      where: { payments: { externalId: Equal(externalPaymentId) } },
      relations: { route: { user: { userData: { organization: true } } } },
    });
  }

  async getHistoryByStatus(
    userId: number,
    paymentStatus: PaymentLinkPaymentStatus[],
    from: Date,
    to: Date,
    externalLinkId?: string,
  ): Promise<PaymentLink[]> {
    return this.find({
      where: {
        route: { user: { id: Equal(userId) }, active: true },
        externalId: externalLinkId ? Equal(externalLinkId) : undefined,
        payments: { status: In(paymentStatus), created: Between(from, to) },
      },
      relations: { route: { user: { userData: { organization: true } } }, payments: true },
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
      relations: { route: { user: { userData: { organization: true } } } },
    });
  }

  private async getPaymentLinkByExternalId(userId: number, externalLinkId: string): Promise<PaymentLink | null> {
    return this.findOne({
      where: { externalId: Equal(externalLinkId), route: { user: { id: Equal(userId) }, active: true } },
      relations: { route: { user: { userData: { organization: true } } } },
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
      relations: { route: { user: { userData: { organization: true } } } },
    });
  }
}
