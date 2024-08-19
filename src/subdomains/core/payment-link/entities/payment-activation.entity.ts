import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { TransferMethod } from '../dto/payment-link.dto';
import { PaymentActivationStatus } from '../enums';
import { PaymentLinkPayment } from './payment-link-payment.entity';

@Entity()
@Index((activation: PaymentActivation) => [activation.method, activation.asset, activation.amount], {
  unique: true,
  where: `status = '${PaymentActivationStatus.PENDING}'`,
})
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
