import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { TransferMethod } from '../dto/payment-link.dto';
import { PaymentActivationStatus } from '../enums';
import { PaymentLinkPayment } from './payment-link-payment.entity';
import { PaymentQuote } from './payment-quote.entity';

@Entity()
export class PaymentActivation extends IEntity {
  @Column()
  status: PaymentActivationStatus;

  @Column()
  method: TransferMethod;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  asset: Asset;

  @Column({ type: 'float' })
  amount: number;

  @Column({ length: 'MAX' })
  paymentRequest: string;

  @Column({ type: 'datetime2' })
  expiryDate: Date;

  @ManyToOne(() => PaymentLinkPayment, (p) => p.activations, { nullable: false })
  payment: PaymentLinkPayment;

  @ManyToOne(() => PaymentQuote, (q) => q.activations, { nullable: true })
  quote: PaymentQuote;

  // --- ENTITY METHODS --- //

  complete(): this {
    this.status = PaymentActivationStatus.COMPLETED;

    return this;
  }

  cancel(): this {
    this.status = PaymentActivationStatus.CANCELLED;

    return this;
  }

  expire(): this {
    this.status = PaymentActivationStatus.EXPIRED;

    return this;
  }
}
