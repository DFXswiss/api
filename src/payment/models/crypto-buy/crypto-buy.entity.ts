import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Buy } from 'src/payment/models/buy/buy.entity';
import { Entity, Column, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import { BankTx } from '../bank-tx/bank-tx.entity';
import { IEntity } from 'src/shared/models/entity';

export enum AmlCheck {
  PASS = 'Pass',
  FAIL = 'Fail',
}

@Entity()
export class CryptoBuy extends IEntity {
  @Column({ type: 'datetime2', nullable: true })
  inputDate: Date;

  @Column({ type: 'float', nullable: true })
  amount: number;

  @ManyToOne(() => Fiat, { nullable: true, eager: true })
  fiat: Fiat;

  @Column({ type: 'float', nullable: true })
  amountInChf: number;

  @Column({ type: 'float', nullable: true })
  amountInEur: number;

  @Column({ length: 256, nullable: true })
  name: string;

  @Column({ length: 256, nullable: true })
  addressLine1: string;

  @Column({ length: 256, nullable: true })
  addressLine2: string;

  @ManyToOne(() => Buy, (buy) => buy.cryptoBuys, { nullable: true })
  buy: Buy;

  @Column({ length: 256, nullable: true })
  amlCheck: AmlCheck;

  @Column({ type: 'float', nullable: true })
  cryptoAmount: number;

  @Column({ length: 256, nullable: true })
  cryptoAsset: string;

  @Column({ type: 'float', nullable: true })
  fee: number;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @Column({ length: 256, nullable: true })
  txId: string;

  @Column({ length: 256, nullable: true })
  usedRef: string;

  @Column({ type: 'float', nullable: true })
  refFactor: number;

  @Column({ type: 'float', nullable: true })
  refProvision: number;

  @Column({ type: 'datetime2', nullable: true })
  outputDate: Date;

  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @OneToOne(() => BankTx, { nullable: false })
  @JoinColumn()
  bankTx: BankTx;
}
