import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Column, Entity, ManyToOne, OneToOne } from 'typeorm';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus } from '../dto/payment-link.dto';
import { PaymentLink } from './payment-link.entity';

@Entity()
export class PaymentLinkPayment extends IEntity {
  @OneToOne(() => PaymentLink)
  paymentLink: PaymentLink;

  @Column({ length: 256, nullable: false })
  uniqueId: string;

  @Column({ length: 256, nullable: false })
  externalId: string;

  @Column({ length: 256, nullable: false })
  status: PaymentLinkPaymentStatus;

  @Column({ type: 'float', nullable: false })
  amount: number;

  @ManyToOne(() => Fiat, { nullable: false })
  fiat: Fiat;

  @Column({ length: 256, nullable: false })
  mode: PaymentLinkPaymentMode;

  @Column({ type: 'datetime2', nullable: false })
  expiryDate: Date;

  @Column({ length: 'MAX' })
  transferAmounts: string;

  // --- ENTITY METHODS --- //

  cancel(): this {
    this.status = PaymentLinkPaymentStatus.CANCELLED;
    return this;
  }
}
