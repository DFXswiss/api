import { merge } from 'lodash';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { DepositRoute } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { PaymentLinkRecipientDto } from '../dto/payment-link-recipient.dto';
import {
  PaymentLinkMode,
  PaymentLinkPaymentStatus,
  PaymentLinkStatus,
  PaymentStandard,
} from '../enums';
import { PaymentLinkPayment } from './payment-link-payment.entity';
import { DefaultPaymentLinkConfig, PaymentLinkConfig } from './payment-link.config';

@Entity()
export class PaymentLink extends IEntity {
  @OneToMany(() => PaymentLinkPayment, (payment) => payment.link, { nullable: true })
  payments?: PaymentLinkPayment[];

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

  @Column({ length: 'MAX', nullable: true })
  comment?: string;

  @Column({ length: 256, default: PaymentLinkMode.MULTIPLE })
  mode: PaymentLinkMode;

  @Column({ length: 'MAX', nullable: true })
  webhookUrl?: string;

  @Column({ length: 256, nullable: true })
  regionManager?: string;

  @Column({ length: 256, nullable: true })
  storeManager?: string;

  @Column({ length: 256, nullable: true })
  storeOwner?: string;

  @Column({ length: 'MAX', nullable: true })
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
}
