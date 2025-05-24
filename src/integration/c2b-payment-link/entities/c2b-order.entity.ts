import { IEntity } from 'src/shared/models/entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { C2BPaymentStatus } from '../share/PaymentStatus';
import { C2BPaymentProvider } from '../share/providers.enum';
import { WebhookNotifications } from './webhook-notifications.entity';

@Entity()
export class C2BPaymentOrder extends IEntity {
  @ManyToOne(() => PaymentQuote, { nullable: false })
  quote: PaymentQuote;

  @Column()
  providerOrderId: string;

  @Column()
  status: C2BPaymentStatus;

  @Column()
  provider: C2BPaymentProvider;

  @OneToMany(() => WebhookNotifications, (webhook) => webhook.order)
  webhooks: WebhookNotifications[];
}
