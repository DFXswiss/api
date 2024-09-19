import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Country } from 'src/shared/models/country/country.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { PaymentLinkStatus, PaymentQuoteStatus, PaymentStandard } from '../enums';
import { PaymentLinkPayment } from './payment-link-payment.entity';
import { PaymentLinkConfig } from './payment-link.config';

@Entity()
export class PaymentLink extends IEntity {
  @OneToMany(() => PaymentLinkPayment, (payment) => payment.link, { nullable: true })
  payments: PaymentLinkPayment[];

  @ManyToOne(() => Sell, { nullable: false })
  route: Sell;

  @Column({ length: 256, nullable: false, unique: true })
  uniqueId: string;

  @Column({ length: 256, nullable: true })
  externalId: string;

  @Column({ length: 256, nullable: false })
  status: PaymentLinkStatus;

  @Column({ length: 'MAX', nullable: true })
  webhookUrl: string;

  @Column({ length: 256, nullable: true })
  name: string;

  @Column({ length: 256, nullable: true })
  street: string;

  @Column({ length: 256, nullable: true })
  houseNumber: string;

  @Column({ length: 256, nullable: true })
  zip: string;

  @Column({ length: 256, nullable: true })
  city: string;

  @ManyToOne(() => Country, { nullable: true, eager: true })
  country: Country;

  @Column({ length: 256, nullable: true })
  phone: string;

  @Column({ length: 256, nullable: true })
  mail: string;

  @Column({ length: 256, nullable: true })
  website: string;

  @Column({ length: 'MAX', nullable: true })
  config: string; // PaymentLinkConfig

  // --- ENTITY METHODS --- //
  get metaId(): string {
    return this.externalId ?? `${this.id}`;
  }

  displayName(paymentMetaId?: string): string {
    const defaultDisplayName = paymentMetaId
      ? `Payment ${paymentMetaId} to ${this.metaId}`
      : `Payment link ${this.metaId}`;

    return this.route.userData.paymentLinksName ?? this.route.userData.verifiedName ?? defaultDisplayName;
  }

  get hasRecipient(): boolean {
    return !!(
      this.name ||
      this.street ||
      this.houseNumber ||
      this.zip ||
      this.city ||
      this.country ||
      this.phone ||
      this.mail ||
      this.website
    );
  }

  get configObj(): PaymentLinkConfig {
    const defaultConfig: PaymentLinkConfig = {
      standards: Object.values(PaymentStandard),
      blockchains: Object.values(Blockchain),
      minCompletionStatus: PaymentQuoteStatus.TX_MEMPOOL,
      displayQr: false,
    };

    const config = this.config ?? this.route.userData.paymentLinksConfig;
    return config ? Object.assign(defaultConfig, JSON.parse(config)) : defaultConfig;
  }

  get defaultStandard(): PaymentStandard {
    return this.configObj.standards[0];
  }

  getMatchingStandard(param?: PaymentStandard): PaymentStandard {
    return this.configObj.standards.includes(param) ? param : this.defaultStandard;
  }
}
