import { IEntity } from 'src/shared/models/entity';
import { Entity, Column, OneToMany } from 'typeorm';
import { BankTx } from './bank-tx.entity';

@Entity()
export class BankTxBatch extends IEntity {
  @Column({ length: 256, unique: true })
  identification: string; // unique

  @Column({ type: 'integer', nullable: true })
  sequenceNumber?: number;

  @Column({ type: 'datetime2', nullable: true })
  creationDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  fromDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  toDate?: Date;

  @Column({ length: 256, nullable: true })
  duplicate?: string;

  @Column({ length: 256, nullable: true })
  iban?: string;

  // balances
  @Column({ type: 'float', nullable: true })
  balanceBeforeAmount?: number;

  @Column({ length: 256, nullable: true })
  balanceBeforeCurrency?: string;

  @Column({ length: 256, nullable: true })
  balanceBeforeCdi?: string;

  @Column({ type: 'float', nullable: true })
  balanceAfterAmount?: number;

  @Column({ length: 256, nullable: true })
  balanceAfterCurrency?: string;

  @Column({ length: 256, nullable: true })
  balanceAfterCdi?: string;

  // entry summary
  @Column({ type: 'integer', nullable: true })
  totalCount?: number;

  @Column({ type: 'float', nullable: true })
  totalAmount?: number;

  @Column({ length: 256, nullable: true })
  totalCdi?: string;

  @Column({ type: 'integer', nullable: true })
  creditCount?: number;

  @Column({ type: 'float', nullable: true })
  creditAmount?: number;

  @Column({ type: 'integer', nullable: true })
  debitCount?: number;

  @Column({ type: 'float', nullable: true })
  debitAmount?: number;

  @OneToMany(() => BankTx, (input) => input.batch)
  transactions: BankTx[];
}
