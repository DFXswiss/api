import { Buy } from 'src/payment/models/buy/buy.entity';
import { Entity, Column, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/util';
import { BankTx } from 'src/payment/models/bank-tx/bank-tx.entity';
import { AmlCheck } from 'src/payment/models/buy-crypto/enums/aml-check.enum';
import { Price } from 'src/payment/models/exchange/dto/price.dto';

@Entity({ name: 'poc_buy_crypto' })
export class PocBuyCrypto extends IEntity {
  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  bankTx: BankTx;

  @ManyToOne(() => Buy, (buy) => buy.buyCryptos, { nullable: false })
  buy: Buy;

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

  defineAssetExchangePair(): this {
    this.outputAsset = this.buy?.asset?.dexName;

    if (this.outputAsset === 'BTC' || this.outputAsset === 'USDC' || this.outputAsset === 'USDT') {
      this.outputReferenceAsset = this.outputAsset;
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

  setOutputAmount(outputAmount: number): this {
    this.outputAmount = outputAmount;

    return this;
  }

  recordTransactionPayout(txId: string): this {
    this.txId = txId;
    this.outputDate = new Date();
    this.isComplete = true;

    return this;
  }

  confirmSentMail(): this {
    this.recipientMail = this.buy.user.userData.mail;
    this.mailSendDate = Date.now();

    return this;
  }

  get targetAddress(): string {
    return this.buy.deposit ? this.buy.deposit.address : this.buy.user.address;
  }
}
