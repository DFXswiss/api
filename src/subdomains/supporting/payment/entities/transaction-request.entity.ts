import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';
import { PaymentMethod } from '../dto/payment-method.enum';
import { TransactionError } from '../services/transaction-helper';

export enum TransactionRequestType {
  Buy = 'Buy',
  Sell = 'Sell',
  Convert = 'Convert',
}

@Entity()
export class TransactionRequest extends IEntity {
  @Column({ nullable: false })
  type: TransactionRequestType;

  @Column({ type: 'integer', nullable: false })
  routeId: number;

  @Column({ type: 'integer', nullable: false })
  sourceId: number;

  @Column({ type: 'integer', nullable: false })
  targetId: number;

  @Column({ type: 'float', nullable: false })
  amount: number;

  @Column({ type: 'float', nullable: false })
  estimatedAmount: number;

  @Column({ nullable: false })
  sourcePaymentMethod: PaymentMethod;

  @Column({ nullable: false })
  targetPaymentMethod: PaymentMethod;

  @Column({ nullable: true })
  externalTransactionId?: string;

  @Column({ type: 'float', nullable: false })
  exchangeRate: number;

  @Column({ type: 'float', nullable: false })
  rate: number;

  @Column({ nullable: true })
  paymentRequest: string;

  @Column({ nullable: true })
  paymentLink: string;

  @Column({ nullable: false })
  isValid: boolean;

  @Column({ nullable: true })
  error: TransactionError;

  @Column({ type: 'float', nullable: false })
  fee: number;

  @Column({ type: 'float', nullable: false })
  minFee: number;
}
