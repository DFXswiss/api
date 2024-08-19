import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus } from '../enums';
import { PaymentActivation } from './payment-activation.entity';
import { PaymentLink } from './payment-link.entity';
import { PaymentQuote } from './payment-quote.entity';

@Entity()
export class PaymentLinkPayment extends IEntity {
  @ManyToOne(() => PaymentLink, (p) => p.payments, { nullable: false })
  @Index({ unique: true, where: `status = '${PaymentLinkPaymentStatus.PENDING}'` })
  link: PaymentLink;

  @Column({ length: 256, nullable: false, unique: true })
  uniqueId: string;

  @Column({ length: 256, nullable: true })
  externalId: string;

  @Column({ length: 256, nullable: false })
  status: PaymentLinkPaymentStatus;

  @Column({ type: 'float', nullable: false })
  amount: number;

  @ManyToOne(() => Fiat, { nullable: false, eager: true })
  currency: Fiat;

  @Column({ length: 256, nullable: false })
  mode: PaymentLinkPaymentMode;

  @Column({ type: 'datetime2', nullable: false })
  expiryDate: Date;

  @OneToMany(() => CryptoInput, (cryptoInput) => cryptoInput.paymentLinkPayment, { nullable: true })
  cryptoInput: CryptoInput;

  @OneToMany(() => PaymentActivation, (activation) => activation.payment, { nullable: true })
  activations: PaymentActivation[];

  @OneToMany(() => PaymentQuote, (quote) => quote.payment, { nullable: true })
  quotes: PaymentQuote[];

  // --- ENTITY METHODS --- //

  complete(): this {
    this.status = PaymentLinkPaymentStatus.COMPLETED;

    return this;
  }

  cancel(): this {
    this.status = PaymentLinkPaymentStatus.CANCELLED;

    return this;
  }

  expire(): this {
    this.status = PaymentLinkPaymentStatus.EXPIRED;

    return this;
  }

  get metaId(): string {
    return this.externalId ?? `${this.id}`;
  }

  get displayName(): string {
    return this.link.route.userData.verifiedName ?? `Payment ${this.metaId} to ${this.link.metaId}`;
  }
}
