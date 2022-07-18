import { IEntity } from 'src/shared/models/entity';
import { Entity, OneToOne, JoinColumn, ManyToOne, Column } from 'typeorm';
import { BankTx } from '../bank-tx/bank-tx.entity';
import { AmlCheck } from '../buy-crypto/enums/aml-check.enum';
import { CryptoInput } from '../crypto-input/crypto-input.entity';
import { Sell } from '../sell/sell.entity';

@Entity()
export class BuyFiat extends IEntity {
  @OneToOne(() => CryptoInput, { nullable: false })
  @JoinColumn()
  cryptoInput: CryptoInput;

  @ManyToOne(() => Sell, (sell) => sell.buyFiats, { nullable: false })
  sell: Sell;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  bankTx: BankTx;

  //Mail
  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @Column({ type: 'datetime2', nullable: true })
  mail1SendDate: Date;

  @Column({ type: 'datetime2', nullable: true })
  mail2SendDate: Date;

  @Column({ type: 'datetime2', nullable: true })
  mail3SendDate: Date;

  //Pricing
  @Column({ type: 'float', nullable: true })
  inputAmount: number;

  @Column({ length: 256, nullable: true })
  inputAsset: string;

  @Column({ type: 'float', nullable: true })
  inputReferenceAmount: number;

  @Column({ length: 256, nullable: true })
  inputReferenceAsset: string;

  @Column({ type: 'float', nullable: true })
  amountInChf: number;

  @Column({ type: 'float', nullable: true })
  amountInEur: number;

  //Check
  @Column({ length: 256, nullable: true })
  amlCheck: AmlCheck;

  @Column({ length: 256, nullable: true })
  amlReason: string;

  @Column({ type: 'float', nullable: true })
  percentFee: number;

  @Column({ type: 'float', nullable: true })
  percentFeeAmount: number;

  @Column({ type: 'float', nullable: true })
  absoluteFeeAmount: number;

  @Column({ type: 'float', nullable: true })
  inputReferenceAmountMinusFee: number;

  //Fail
  @Column({ length: 256, nullable: true })
  cryptoReturnTxId: string;

  @Column({ type: 'datetime2', nullable: true })
  cryptoReturnDate: Date;

  @Column({ type: 'datetime2', nullable: true })
  mailReturnSendDate: Date;

  // Pass
  @Column({ type: 'float', nullable: true })
  outputReferenceAmount: number;

  @Column({ length: 256, nullable: true })
  outputReferenceAsset: string;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @Column({ length: 256, nullable: true })
  outputAsset: string;

  //
  @Column({ length: 256, nullable: true })
  remittanceInfo: string;

  @Column({ nullable: true })
  instantSepa: boolean;

  @Column({ length: 256, nullable: true })
  usedBank: string;

  @Column({ type: 'float', nullable: true })
  bankBatchId: number;

  @Column({ type: 'datetime2', nullable: true })
  bankStartTimestamp: Date;

  @Column({ type: 'datetime2', nullable: true })
  bankFinishTimestamp: Date;

  @Column({ length: 256, nullable: true })
  info: string;

  @Column({ type: 'datetime2', nullable: true })
  outputDate: Date;

  //
  @Column({ default: false })
  isComplete: boolean;
}
