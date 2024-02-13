import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';
import { TransactionError } from '../services/transaction-helper';

export enum TransactionRequestType {
  Buy = 'Buy',
  Sell = 'Sell',
  Convert = 'Convert',
}

@Entity()
export class TransactionRequest extends IEntity {
  @Column({ type: 'integer', nullable: false })
  routeId: number;

  @Column({ type: 'float', nullable: false })
  fee: number;

  @Column({ type: 'float', nullable: false })
  minFee: number;

  @Column({ type: 'float', nullable: false })
  minVolume: number;

  @Column({ type: 'float', nullable: false })
  maxVolume: number;

  @Column({ type: 'float', nullable: false })
  amount: number;

  @Column({ type: 'integer', nullable: false })
  sourceId: number;

  @Column({ type: 'integer', nullable: false })
  targetId: number;

  @Column({ type: 'float', nullable: false })
  minFeeTarget: number;

  @Column({ type: 'float', nullable: false })
  minVolumeTarget: number;

  @Column({ type: 'float', nullable: false })
  maxVolumeTarget: number;

  @Column({ type: 'float', nullable: false })
  exchangeRate: number;

  @Column({ type: 'float', nullable: false })
  rate: number;

  @Column({ type: 'float', nullable: false })
  estimatedAmount: number;

  @Column({ nullable: true })
  paymentRequest: string;

  @Column({ nullable: true })
  paymentLink: string;

  @Column({ nullable: false })
  isValid: boolean;

  @Column({ nullable: true })
  error: TransactionError;

  @Column({ nullable: false })
  type: TransactionRequestType;
}
