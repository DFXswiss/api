import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus } from '../dto/payment-link.dto';
import { PaymentLink } from './payment-link.entity';

@Entity()
export class PaymentLinkPayment extends IEntity {
  @ManyToOne(() => PaymentLink)
  @Index({ unique: true, where: `status = ${PaymentLinkPaymentStatus.PENDING}` })
  link: PaymentLink;

  @Column({ length: 256, nullable: false, unique: true })
  uniqueId: string;

  @Column({ length: 256, nullable: true })
  externalId: string;

  @Column({ length: 256, nullable: false })
  status: PaymentLinkPaymentStatus;

  @Column({ type: 'float', nullable: false })
  amount: number;

  @ManyToOne(() => Fiat, { nullable: false })
  currency: Fiat;

  @Column({ length: 256, nullable: false })
  mode: PaymentLinkPaymentMode;

  @Column({ type: 'datetime2', nullable: false })
  expiryDate: Date;

  @Column({ length: 'MAX' })
  transferAmounts: string;
}
