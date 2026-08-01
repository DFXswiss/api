import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { Between, EntityManager, Equal, In } from 'typeorm';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkPaymentStatus } from '../enums';

/**
 * What `createPosLinkFor` reads to build a point-of-sale link.
 *
 * Three configuration sources can be merged into the answer, and which ones depends on the `scoped`
 * argument: the link's own config, the account's, and the recipient block the account's address and
 * contact data make up. The union of the three is the field list.
 *
 * The organization side is here because `UserData.address` switches to it for organization and
 * sole-proprietorship accounts — the same five values, read off another row.
 */
export const POS_LINK_RESPONSE_FIELDS = [
  'paymentLink.uniqueId',
  'paymentLink.config',
  'posUserData.accountType',
  // `completeName`: the organization name, falling back to the two personal ones.
  'posUserData.organizationName',
  'posUserData.firstname',
  'posUserData.surname',
  'posUserData.phone',
  'posUserData.mail',
  'posUserData.paymentLinksConfig',
  'posUserData.street',
  'posUserData.houseNumber',
  'posUserData.location',
  'posUserData.zip',
  'posCountry.symbol',
  'posOrganization.street',
  'posOrganization.houseNumber',
  'posOrganization.location',
  'posOrganization.zip',
  'posOrganizationCountry.symbol',
];

/**
 * `PUT /paymentLink/:id/pos` — 513 columns before.
 *
 * The endpoint writes, but through `update(id, …)` on the link and on the account rather than by
 * saving either row back, so a projected read cannot blank a column it did not load. `config` is
 * part of the projection for that reason as much as for the response: the write merges the new
 * access key into the existing configuration, and a config the query did not load would be a
 * configuration silently reset.
 */
export const POS_LINK_PROJECTION = new ReadProjection<PaymentLink>(
  'paymentLink',
  [
    ['paymentLink.route', 'posRoute'],
    ['posRoute.user', 'posUser'],
    ['posUser.userData', 'posUserData'],
    ['posUserData.country', 'posCountry'],
    ['posUserData.organization', 'posOrganization'],
    ['posOrganization.country', 'posOrganizationCountry'],
  ],
  POS_LINK_RESPONSE_FIELDS,
  // Never part of the answer: the primary keys that make the ORM materialise the joined rows, and
  // the two ids the two updates are scoped by.
  [
    'paymentLink.id',
    'posRoute.id',
    'posUser.id',
    'posUserData.id',
    'posCountry.id',
    'posOrganization.id',
    'posOrganizationCountry.id',
  ],
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
  async findForPosLink(id: number, fields: ReadonlyArray<string> = POS_LINK_PROJECTION.fields): Promise<PaymentLink> {
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
