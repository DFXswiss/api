import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne, OneToOne } from 'typeorm';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { PaymentLinkStatus } from '../dto/payment-link.dto';
import { PaymentLinkPayment } from './payment-link-payment.entity';

@Entity()
export class PaymentLink extends IEntity {
  @OneToOne(() => PaymentLinkPayment, { nullable: true, eager: true })
  paymentLinkPayment: PaymentLinkPayment;

  @ManyToOne(() => Sell)
  route: Sell;

  @Column({ length: 256, nullable: false })
  uniqueId: string;

  @Column({ length: 256, nullable: true })
  externalId: string;

  @Column({ length: 256, nullable: false })
  status: PaymentLinkStatus;
}
