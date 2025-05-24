import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { C2BPaymentProvider } from '../share/providers.enum';
import { C2BPaymentOrder } from './c2b-order.entity';

@Entity('webhook_notifications')
export class WebhookNotifications extends IEntity {
  @ManyToOne(() => C2BPaymentOrder)
  order: C2BPaymentOrder;

  @Column()
  provider: C2BPaymentProvider;

  @Column({ length: 'MAX', nullable: true })
  payload: string;
}
