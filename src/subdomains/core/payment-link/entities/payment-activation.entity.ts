import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { PaymentLinkPayment } from './payment-link-payment.entity';

export enum PaymentActivationStatus {
  PENDING = 'Pending',
  EXPIRED = 'Expired',
  DUPLICATE = 'Duplicate',
  FAILED = 'Failed',
  COMPLETED = 'Completed',
}

@Entity()
export class PaymentActivation extends IEntity {
  @Column()
  status: PaymentActivationStatus;

  @Column()
  method: Blockchain;

  @ManyToOne(() => Asset, { eager: true })
  asset: Asset;

  @Column({ type: 'float' })
  amount: number;

  @Column({ length: 'MAX' })
  paymentRequest: string;

  @Column({ type: 'datetime2' })
  expiryDate: Date;

  @ManyToOne(() => PaymentLinkPayment, (p) => p.activations)
  payment: PaymentLinkPayment;

  // --- ENTITY METHODS --- //

  complete(): this {
    this.status = PaymentActivationStatus.COMPLETED;

    return this;
  }

  expire(): this {
    this.status = PaymentActivationStatus.EXPIRED;

    return this;
  }
}
