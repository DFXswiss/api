import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus } from '../enums';
import { PaymentActivation } from './payment-activation.entity';
import { PaymentLink } from './payment-link.entity';
import { PaymentQuote } from './payment-quote.entity';

export interface PaymentDevice {
  id: string;
  command: string;
}

@Entity()
export class PaymentLinkPayment extends IEntity {
  @ManyToOne(() => PaymentLink, (p) => p.payments, { nullable: false })
  @Index({ unique: true, where: `status = '${PaymentLinkPaymentStatus.PENDING}'` })
  link: PaymentLink;

  @Column({ length: 256, unique: true })
  uniqueId: string;

  @Column({ length: 256, nullable: true })
  externalId?: string;

  @Column({ length: 256, nullable: true })
  note?: string;

  @Column({ length: 256 })
  status: PaymentLinkPaymentStatus;

  @Column({ type: 'float' })
  amount: number;

  @ManyToOne(() => Fiat, { nullable: false, eager: true })
  currency: Fiat;

  @Column({ length: 256 })
  mode: PaymentLinkPaymentMode;

  @Column({ type: 'datetime2' })
  expiryDate: Date;

  @Column({ default: 0 })
  txCount: number;

  @Column({ default: false })
  isConfirmed: boolean;

  @Column({ length: 256, nullable: true })
  deviceId?: string;

  @Column({ length: 'MAX', nullable: true })
  deviceCommand?: string;

  @OneToMany(() => CryptoInput, (cryptoInput) => cryptoInput.paymentLinkPayment, { nullable: true })
  cryptoInputs?: CryptoInput[];

  @OneToMany(() => PaymentActivation, (activation) => activation.payment, { nullable: true })
  activations?: PaymentActivation[];

  @OneToMany(() => PaymentQuote, (quote) => quote.payment, { nullable: true })
  quotes?: PaymentQuote[];

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
    return this.link.displayName(this.metaId);
  }

  get memo(): string {
    return `${this.displayName} - ${this.currency.name} ${this.amount}`;
  }

  get device(): PaymentDevice | undefined {
    return this.deviceId && this.deviceCommand ? { id: this.deviceId, command: this.deviceCommand } : undefined;
  }
}
