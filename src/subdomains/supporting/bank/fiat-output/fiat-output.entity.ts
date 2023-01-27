import { IEntity } from 'src/shared/models/entity';
import { Entity, OneToOne, Column, JoinColumn } from 'typeorm';
import { BuyFiat } from '../../../core/sell-crypto/buy-fiat/buy-fiat.entity';
import { BankTx } from '../bank-tx/bank-tx.entity';
import { TransactionCharge } from '../bank-tx/frick.service';

@Entity()
export class FiatOutput extends IEntity {
  @OneToOne(() => BuyFiat, (buyFiat) => buyFiat.fiatOutput, { nullable: true })
  buyFiat?: BuyFiat;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  bankTx: BankTx;

  @Column({ length: 256, nullable: false })
  type: string;

  @Column({ type: 'integer', nullable: true })
  originEntityId?: number;

  @Column({ length: 256, nullable: true })
  accountIban?: string;

  @Column({ type: 'integer', nullable: true })
  batchId?: number;

  @Column({ type: 'float', nullable: true })
  batchAmount?: number;

  @Column({ length: 256, nullable: true })
  charge?: TransactionCharge;

  @Column({ default: false })
  isInstant?: boolean;

  @Column({ type: 'datetime2', nullable: true })
  valutaDate?: Date;

  @Column({ nullable: true })
  currency?: string;

  @Column({ type: 'float', nullable: true })
  amount?: number;

  @Column({ length: 256, nullable: true })
  remittanceInfo?: string;

  @Column({ type: 'integer', nullable: true })
  accountNumber?: number;

  @Column({ length: 256, nullable: true })
  name?: string;

  @Column({ length: 256, nullable: true })
  address?: string;

  @Column({ length: 256, nullable: true })
  zip?: string;

  @Column({ length: 256, nullable: true })
  city?: string;

  @Column({ length: 256, nullable: true })
  country?: string;

  @Column({ length: 256, nullable: true })
  iban?: string;

  @Column({ length: 256, nullable: true })
  aba?: string;

  @Column({ length: 256, nullable: true })
  bic?: string;

  @Column({ length: 256, nullable: true })
  creditInstitution?: string;

  @Column({ length: 256, nullable: true })
  pmtInfId?: string;

  @Column({ length: 256, nullable: true })
  instrId?: string;

  @Column({ length: 256, nullable: true })
  endToEndId?: string;

  @Column({ type: 'datetime2', nullable: true })
  isReadyDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  isTransmittedDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  isConfirmedDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  isApprovedDate?: Date;

  @Column({ default: false })
  isComplete?: boolean;

  @Column({ length: 256, nullable: true })
  info?: string;

  @Column({ type: 'datetime2', nullable: true })
  outputDate?: Date;
}
