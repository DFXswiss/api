import { Buy } from 'src/payment/models/buy/buy.entity';
import { Entity, Column, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import { BankTx } from '../../bank-tx/bank-tx.entity';
import { IEntity } from 'src/shared/models/entity';
import { Price } from '../../exchange/dto/price.dto';
import { BuyCryptoBatch } from './buy-crypto-batch.entity';
import { Util } from 'src/shared/util';
import { AmlCheck } from '../enums/aml-check.enum';
import { CryptoRoute } from '../../crypto-route/crypto-route.entity';
import { CryptoInput } from '../../crypto-input/crypto-input.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { User } from 'src/user/models/user/user.entity';

@Entity()
export class BuyCrypto extends IEntity {
  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  bankTx: BankTx;

  @ManyToOne(() => Buy, (buy) => buy.buyCryptos, { nullable: true })
  buy: Buy;

  @OneToOne(() => CryptoInput, (input) => input.buyCrypto, { nullable: true })
  @JoinColumn()
  cryptoInput: CryptoInput;

  @ManyToOne(() => CryptoRoute, (cryptoRoute) => cryptoRoute.buyCryptos, { nullable: true })
  cryptoRoute: CryptoRoute;

  @ManyToOne(() => BuyCryptoBatch, (batch) => batch.transactions, { eager: true, nullable: true })
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

  @Column({ type: 'datetime2', nullable: true })
  chargebackDate: Date;

  @Column({ length: 256, nullable: true })
  chargebackRemittanceInfo: string;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  chargebackBankTx: BankTx;

  defineAssetExchangePair(): this {
    this.outputAsset = this.target?.asset?.dexName;

    if (this.outputAsset === 'BTC' || this.outputAsset === 'USDC' || this.outputAsset === 'USDT') {
      this.outputReferenceAsset = this.outputAsset;
    } else {
      this.outputReferenceAsset = 'BTC';
    }

    return this;
  }

  calculateOutputReferenceAmount(prices: Price[]): this {
    if (this.inputReferenceAsset === this.outputReferenceAsset) {
      this.outputReferenceAmount = Util.round(this.inputReferenceAmountMinusFee, 8);
    } else {
      const price = prices.find(
        (p) => p.currencyPair.includes(this.inputReferenceAsset) && p.currencyPair.includes(this.outputReferenceAsset),
      );

      if (!price) {
        throw new Error(
          `Cannot calculate outputReferenceAmount, ${this.inputReferenceAsset}/${this.outputReferenceAsset} price is missing`,
        );
      }

      if (!price.price) {
        throw new Error('Cannot calculate outputReferenceAmount, price value is 0');
      }

      this.outputReferenceAmount = Util.round(this.inputReferenceAmountMinusFee / price.price, 8);
    }

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

  complete(): this {
    this.isComplete = true;

    return this;
  }

  confirmSentMail(): this {
    this.recipientMail = this.user.userData.mail;
    this.mailSendDate = Date.now();

    return this;
  }

  get user(): User {
    return this.buy ? this.buy.user : this.cryptoRoute.user;
  }

  get target(): { address: string; asset: Asset } {
    return this.buy
      ? {
          address: this.buy.deposit?.address ?? this.buy.user.address,
          asset: this.buy.asset,
        }
      : {
          address: this.cryptoRoute.targetDeposit?.address ?? this.cryptoRoute.user.address,
          asset: this.cryptoRoute.asset,
        };
  }
}
