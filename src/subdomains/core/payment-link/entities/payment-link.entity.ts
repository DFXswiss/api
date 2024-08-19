import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { PaymentLinkStatus } from '../enums';
import { PaymentLinkPayment } from './payment-link-payment.entity';

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

  // --- ENTITY METHODS --- //
  get metaId(): string {
    return this.externalId ?? `${this.id}`;
  }
}
