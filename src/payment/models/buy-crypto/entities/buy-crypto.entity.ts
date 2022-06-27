import { Buy } from 'src/payment/models/buy/buy.entity';
import { Entity, Column, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import { BankTx } from '../../bank-tx/bank-tx.entity';
import { IEntity } from 'src/shared/models/entity';
import { Price } from '../../exchange/dto/price.dto';
import { BuyCryptoBatch } from './buy-crypto-batch.entity';
import { Util } from 'src/shared/util';
import { AmlCheck } from '../enums/aml-check.enum';

@Entity()
export class BuyCrypto extends IEntity {
  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  bankTx: BankTx;

  @ManyToOne(() => Buy, (buy) => buy.cryptoBuys, { nullable: false })
  buy: Buy;

  @ManyToOne(() => BuyCryptoBatch, (batch) => batch.transactions, { eager: true, nullable: true, onUpdate: 'CASCADE' })
  batch: BuyCryptoBatch;

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

  @Column({ length: 256, nullable: true })
  amlCheck: AmlCheck;

  @Column({ type: 'float', nullable: true })
  percentFee: number;

  @Column({ type: 'float', nullable: true })
  percentFeeAmount: number;

  @Column({ type: 'float', nullable: true })
  absoluteFeeAmount: number;

  @Column({ type: 'float', nullable: true })
  inputReferenceAmountMinusFee: number;

  @Column({ type: 'float', nullable: true })
  outputReferenceAmount: number;

  @Column({ length: 256, nullable: true })
  outputReferenceAsset: string;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @Column({ length: 256, nullable: true })
  outputAsset: string;

  @Column({ length: 256, nullable: true })
  txId: string;

  @Column({ type: 'integer', nullable: true })
  blockHeight: number;

  @Column({ default: false })
  isComplete: boolean;

  @Column({ type: 'datetime2', nullable: true })
  outputDate: Date;

  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @Column({ type: 'float', nullable: true })
  mailSendDate: number;

  @Column({ length: 256, nullable: true })
  usedRef: string;

  @Column({ type: 'float', nullable: true })
  refProvision: number;

  @Column({ type: 'float', nullable: true })
  refFactor: number;

  defineAssetExchangePair(outputAsset: string): this {
    this.outputAsset = outputAsset;

    if (outputAsset === 'BTC' || outputAsset === 'USDC' || outputAsset === 'USDT') {
      this.outputReferenceAsset = outputAsset;
    } else {
      this.outputReferenceAsset = 'BTC';
    }

    return this;
  }

  calculateOutputReferenceAmount(price: Price): this {
    if (!price) {
      throw new Error('Provided input is not an instance of Price');
    }

    if (!price.currencyPair.includes('EUR')) {
      throw new Error('Cannot calculate outputReferenceAmount, EUR price is required');
    }

    if (!price.price) {
      throw new Error('Cannot calculate outputReferenceAmount, price value is 0');
    }

    this.outputReferenceAmount = Util.round(this.inputReferenceAmountMinusFee / price.price, 8);

    return this;
  }

  calculateOutputAmount(batchReferenceAmount: number, batchOutputAmount: number): this {
    if (batchReferenceAmount === 0) {
      throw new Error('Cannot calculate outputAmount, provided batchReferenceAmount is 0');
    }

    this.outputAmount = Util.round((this.outputReferenceAmount / batchReferenceAmount) * batchOutputAmount, 8);

    return this;
  }

  recordTransactionPayout(txId: string): this {
    this.txId = txId;
    this.outputDate = new Date();

    return this;
  }

  complete(blockHeight: number): this {
    this.isComplete = true;
    this.blockHeight = blockHeight;

    return this;
  }

  confirmSentMail(): this {
    this.recipientMail = this.buy.user.userData.mail;
    this.mailSendDate = Date.now();

    return this;
  }
}
