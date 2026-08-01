import { merge } from 'lodash';
import { Config } from 'src/config/config';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { DepositRoute } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { PaymentLinkRecipientDto } from '../dto/payment-link-recipient.dto';
import { PaymentLinkMode, PaymentLinkPaymentStatus, PaymentLinkStatus, PaymentStandard } from '../enums';
import { PaymentLinkPayment } from './payment-link-payment.entity';
import { DefaultPaymentLinkConfig, PaymentLinkConfig } from './payment-link.config';

@Entity()
export class PaymentLink extends IEntity {
  @OneToMany(() => PaymentLinkPayment, (payment) => payment.link, { nullable: true })
  payments?: PaymentLinkPayment[];

  @Index()
  @ManyToOne(() => DepositRoute, { nullable: false })
  route: DepositRoute;

  @Column({ length: 256, unique: true })
  uniqueId: string;

  @Column({ length: 256, nullable: true })
  externalId?: string;

  @Column({ length: 256, nullable: true })
  label?: string;

  @Column({ length: 256 })
  status: PaymentLinkStatus;

  @Column({ length: 256, nullable: true })
  publicStatus?: string;

  @Column({ type: 'text', nullable: true })
  comment?: string;

  @Column({ length: 256, default: PaymentLinkMode.MULTIPLE })
  mode: PaymentLinkMode;

  @Column({ type: 'text', nullable: true })
  webhookUrl?: string;

  @Column({ type: 'int', default: 0 })
  webhookFailCount: number;

  @Column({ type: 'timestamp', nullable: true })
  webhookLastFailedAt?: Date;

  @Column({ length: 256, nullable: true })
  regionManager?: string;

  @Column({ length: 256, nullable: true })
  storeManager?: string;

  @Column({ length: 256, nullable: true })
  storeOwner?: string;

  @Column({ type: 'text', nullable: true })
  config?: string; // PaymentLinkConfig

  // --- ENTITY METHODS --- //
  get metaId(): string {
    return this.label ?? this.externalId ?? `${this.id}`;
  }

  displayName(paymentMetaId?: string): string {
    const defaultDisplayName = paymentMetaId
      ? `Payment ${paymentMetaId} to ${this.metaId}`
      : `Payment link ${this.metaId}`;

    return (
      this.route.userData.paymentLinksName ??
      this.route.userData.verifiedName ??
      this.configObj.recipient?.name ??
      defaultDisplayName
    );
  }

  get configObj(): PaymentLinkConfig {
    const userData = this.route.userData;

    const userDataRecipient: PaymentLinkRecipientDto = Util.removeNullFields({
      name: userData.completeName,
      address: userData.address.country
        ? {
            ...userData.address,
            country: userData.address.country?.symbol,
          }
        : undefined,
      phone: userData.phone,
      mail: userData.mail,
    });

    const linkConfig: PaymentLinkConfig = JSON.parse(this.config ?? '{}');

    const recipient = merge(userDataRecipient, userData.paymentLinksConfigObj.recipient, linkConfig.recipient);

    return Object.assign({}, DefaultPaymentLinkConfig, userData.paymentLinksConfigObj, linkConfig, { recipient });
  }

  get linkConfigObj(): PaymentLinkConfig {
    return Object.assign({}, DefaultPaymentLinkConfig, JSON.parse(this.config ?? '{}'));
  }

  /**
   * The configuration a point-of-sale link reads its access keys from, scoped to the link, to the
   * account, or merged with the link winning.
   *
   * Separate from `configObj` because that one also assembles the recipient — name, contact data
   * and address of the account — which `PaymentLinkService.createPosLinkFor` discards. Each side is
   * read lazily: both getters parse their own JSON column, and a scoped call must not fail on the
   * column it does not use.
   */
  accessConfig(scoped?: boolean): PaymentLinkConfig {
    const account = (): PaymentLinkConfig => this.route.userData.paymentLinksConfigObj;
    const link = (): PaymentLinkConfig => this.linkConfigObj;

    return scoped == null ? { ...account(), ...link() } : scoped ? link() : account();
  }

  get defaultStandard(): PaymentStandard {
    return this.configObj.standards[0];
  }

  get totalCompletedAmount(): number {
    return (
      Util.sumObjValue(
        this.payments?.filter((p) => p.status === PaymentLinkPaymentStatus.COMPLETED),
        'amount',
      ) ?? 0
    );
  }

  getMatchingStandard(param?: PaymentStandard): PaymentStandard {
    return this.configObj.standards.includes(param) ? param : this.defaultStandard;
  }

  get isWebhookInCooldown(): boolean {
    if (this.webhookFailCount < Config.payment.webhookFailureThreshold) return false;

    return Util.secondsDiff(this.webhookLastFailedAt, new Date()) < Config.payment.webhookFailureCooldown;
  }

  webhookSucceeded(): UpdateResult<PaymentLink> {
    const update: Partial<PaymentLink> = { webhookFailCount: 0, webhookLastFailedAt: null };

    Object.assign(this, update);

    return [this.id, update];
  }

  webhookFailed(): UpdateResult<PaymentLink> {
    const update: Partial<PaymentLink> = {
      webhookFailCount: this.webhookFailCount + 1,
      webhookLastFailedAt: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
