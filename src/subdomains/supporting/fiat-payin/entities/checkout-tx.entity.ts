import { CheckoutPaymentStatus, CheckoutPaymentType } from 'src/integration/checkout/dto/checkout.dto';
import { IEntity } from 'src/shared/models/entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { Transaction } from '../../payment/entities/transaction.entity';

@Entity()
export class CheckoutTx extends IEntity {
  @Column({ unique: true })
  paymentId: string;

  @Column({ type: 'datetime2' })
  requestedOn: Date;

  @Column({ type: 'datetime2', nullable: true })
  expiresOn?: Date;

  @Column({ type: 'float' })
  amount: number;

  @Column()
  currency: string;

  @Column()
  status: CheckoutPaymentStatus;

  @Column()
  approved: boolean;

  @Column({ nullable: true })
  reference?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  type?: CheckoutPaymentType;

  @Column({ nullable: true })
  cardName?: string;

  @Column({ nullable: true })
  cardFingerPrint?: string;

  @Column({ nullable: true })
  ip?: string;

  @Column({ nullable: true })
  risk?: boolean;

  @Column({ type: 'integer', nullable: true })
  riskScore?: number;

  @Column({ length: 'MAX' })
  raw: string;

  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.checkoutTx, { nullable: true })
  buyCrypto?: BuyCrypto;

  @OneToOne(() => Transaction, { nullable: true })
  @JoinColumn()
  transaction: Transaction;
}
