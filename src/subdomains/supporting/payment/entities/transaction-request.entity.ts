import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { PaymentMethod } from '../dto/payment-method.enum';
import { QuoteError } from '../dto/transaction-helper/quote-error.enum';

export enum TransactionRequestType {
  Buy = 'Buy',
  Sell = 'Sell',
  Swap = 'Swap',
}

@Entity()
export class TransactionRequest extends IEntity {
  @Column()
  type: TransactionRequestType;

  @Column({ type: 'integer' })
  routeId: number;

  @Column({ type: 'integer' })
  sourceId: number;

  @Column({ type: 'integer' })
  targetId: number;

  @Column({ type: 'float' })
  amount: number;

  @Column({ type: 'float' })
  estimatedAmount: number;

  @Column()
  sourcePaymentMethod: PaymentMethod;

  @Column()
  targetPaymentMethod: PaymentMethod;

  @Column({ nullable: true })
  externalTransactionId?: string;

  @Column({ type: 'float' })
  exchangeRate: number;

  @Column({ type: 'float' })
  rate: number;

  @Column({ length: 'MAX', nullable: true })
  paymentRequest: string;

  @Column({ nullable: true })
  paymentLink: string;

  @Column()
  isValid: boolean;

  @Column({ nullable: true })
  error: QuoteError;

  @Column({ type: 'float', nullable: true })
  dfxFee: number;

  @Column({ type: 'float', nullable: true })
  networkFee: number;

  @Column({ type: 'float', nullable: true })
  totalFee: number;

  @Column({ default: false })
  exactPrice: boolean;

  @Column({ default: false })
  isComplete: boolean;

  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Column({ length: 'MAX', nullable: true })
  siftScore: string;
}
