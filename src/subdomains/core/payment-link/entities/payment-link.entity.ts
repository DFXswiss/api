import { GetConfig } from 'src/config/config';

import { GoodsCategory, GoodsType, MerchantMCC, StoreType } from 'src/integration/binance-pay/dto/binance.dto';
import { PaymentLinkBlockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Country } from 'src/shared/models/country/country.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { PaymentLinkRecipientDto } from '../dto/payment-link-recipient.dto';
import { PaymentLinkMode, PaymentLinkStatus, PaymentQuoteStatus, PaymentStandard } from '../enums';
import { PaymentLinkPayment } from './payment-link-payment.entity';
import { PaymentLinkConfig } from './payment-link.config';

export const DefaultPaymentLinkConfig: PaymentLinkConfig = {
  standards: Object.values(PaymentStandard),
  blockchains: Object.values(PaymentLinkBlockchain),
  minCompletionStatus: PaymentQuoteStatus.TX_MEMPOOL,
  displayQr: false,
  fee: 0.002,
  paymentTimeout: GetConfig().payment.defaultPaymentTimeout,
};

@Entity()
export class PaymentLink extends IEntity {
  @OneToMany(() => PaymentLinkPayment, (payment) => payment.link, { nullable: true })
  payments?: PaymentLinkPayment[];

  @ManyToOne(() => Sell, { nullable: false })
  route: Sell;

  @Column({ length: 256, unique: true })
  uniqueId: string;

  @Column({ length: 256, nullable: true })
  externalId?: string;

  @Column({ length: 256, nullable: true })
  label?: string;

  @Column({ length: 256 })
  status: PaymentLinkStatus;

  @Column({ length: 256, default: PaymentLinkMode.MULTIPLE })
  mode: PaymentLinkMode;

  @Column({ length: 'MAX', nullable: true })
  webhookUrl?: string;

  @Column({ length: 256, nullable: true })
  name?: string;

  @Column({ length: 256, nullable: true })
  street?: string;

  @Column({ length: 256, nullable: true })
  houseNumber?: string;

  @Column({ length: 256, nullable: true })
  zip?: string;

  @Column({ length: 256, nullable: true })
  city?: string;

  @ManyToOne(() => Country, { nullable: true, eager: true })
  country?: Country;

  @Column({ length: 256, nullable: true })
  phone?: string;

  @Column({ length: 256, nullable: true })
  mail?: string;

  @Column({ length: 256, nullable: true })
  regionManager?: string;

  @Column({ length: 256, nullable: true })
  storeManager?: string;

  @Column({ length: 256, nullable: true })
  storeOwner?: string;

  @Column({ length: 256, nullable: true })
  website?: string;

  @Column({ length: 'MAX', nullable: true })
  config?: string; // PaymentLinkConfig

  @Column({ nullable: true })
  registrationNumber?: string; // Registration number/Company tax ID

  @Column({ nullable: true })
  storeType?: StoreType;

  @Column({ nullable: true })
  merchantMcc?: MerchantMCC;

  @Column({ nullable: true })
  goodsType?: GoodsType;

  @Column({ nullable: true })
  goodsCategory?: GoodsCategory;

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

  get recipient(): PaymentLinkRecipientDto | undefined {
    if (this.hasRecipient) {
      return {
        name: this.name,
        address: {
          street: this.street,
          houseNumber: this.houseNumber,
          zip: this.zip,
          city: this.city,
          country: this.country?.name,
        },
        phone: this.phone,
        mail: this.mail,
        website: this.website,
      };
    }

    // fallback to config
    const { recipient } = this.configObj;
    if (recipient) return recipient;

    // fallback to user data
    const userData = this.route.userData;
    return {
      name: userData.completeName,
      address: {
        ...userData.address,
        country: userData.address.country?.name,
      },
      phone: userData.phone,
      mail: userData.mail,
      website: null,
    };
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
    return Object.assign(
      {},
      DefaultPaymentLinkConfig,
      this.route.userData.paymentLinksConfigObj,
      JSON.parse(this.config ?? '{}'),
    );
  }

  get linkConfigObj(): PaymentLinkConfig {
    return Object.assign({}, DefaultPaymentLinkConfig, JSON.parse(this.config ?? '{}'));
  }

  get defaultStandard(): PaymentStandard {
    return this.configObj.standards[0];
  }

  getMatchingStandard(param?: PaymentStandard): PaymentStandard {
    return this.configObj.standards.includes(param) ? param : this.defaultStandard;
  }

  get paymentTimeout(): number {
    return this.configObj.paymentTimeout;
  }
}
