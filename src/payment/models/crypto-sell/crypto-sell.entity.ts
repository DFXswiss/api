import { IEntity } from 'src/shared/models/entity';
import { Entity, Column, OneToOne, JoinColumn } from 'typeorm';
import { BankTx } from '../bank-tx/bank-tx.entity';
import { AmlCheck } from '../crypto-buy/enums/aml-check.enum';

import { CryptoInput } from '../crypto-input/crypto-input.entity';

@Entity()
export class CryptoSell extends IEntity {
  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @Column({ type: 'float', nullable: true })
  mail1SendDate: number;

  @Column({ type: 'float', nullable: true })
  mail2SendDate: number;

  @Column({ type: 'float', nullable: true })
  mail3SendDate: number;

  @Column({ type: 'float', nullable: true })
  fee: number;

  @Column({ type: 'float', nullable: true })
  fiatReferenceAmount: number;

  @Column({ length: 256, nullable: true })
  fiatReferenceCurrency: string;

  @Column({ type: 'float', nullable: true })
  amountInChf: number;

  @Column({ type: 'float', nullable: true })
  amountInEur: number;

  @Column({ length: 256, nullable: true })
  amlCheck: AmlCheck;

  @Column({ length: 256, nullable: true })
  iban: string;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @Column({ length: 256, nullable: true })
  outputCurrency: string;

  @Column({ length: 256, nullable: true })
  bankUsage: string;

  @Column({ type: 'datetime2', nullable: true })
  outputDate: Date;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  bankTx: BankTx;

  @OneToOne(() => CryptoInput, { nullable: false })
  @JoinColumn()
  cryptoInput: CryptoInput;
}
