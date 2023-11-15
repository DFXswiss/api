import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { FiatOutput } from '../../../supporting/fiat-output/fiat-output.entity';
import { AmlReason } from '../../buy-crypto/process/enums/aml-reason.enum';
import { CheckStatus } from '../../buy-crypto/process/enums/check-status.enum';
import { Sell } from '../route/sell.entity';

@Entity()
export class BuyFiat extends IEntity {
  // References
  @OneToOne(() => CryptoInput, { nullable: false })
  @JoinColumn()
  cryptoInput: CryptoInput;

  @OneToOne(() => FiatOutput, { nullable: true })
  @JoinColumn()
  fiatOutput: FiatOutput;

  @ManyToOne(() => Sell, (sell) => sell.buyFiats, { nullable: false })
  sell: Sell;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  bankTx: BankTx;

  // Mail
  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @Column({ type: 'datetime2', nullable: true })
  mail1SendDate: Date;

  @Column({ type: 'datetime2', nullable: true })
  mail2SendDate: Date;

  @Column({ type: 'datetime2', nullable: true })
  mail3SendDate: Date;

  // Pricing
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

  // Ref
  @Column({ length: 256, nullable: true })
  usedRef: string;

  @Column({ type: 'float', nullable: true })
  refProvision: number;

  @Column({ type: 'float', nullable: true })
  refFactor: number;

  // Check
  @Column({ length: 256, nullable: true })
  amlCheck: CheckStatus;

  @Column({ length: 256, nullable: true })
  amlReason: AmlReason;

  @Column({ nullable: true })
  highRisk: boolean;

  // Fee
  @Column({ length: 256, nullable: true })
  usedFeeIds: string;

  @Column({ type: 'float', nullable: true })
  percentFee: number;

  @Column({ type: 'float', nullable: true })
  percentFeeAmount: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  absoluteFeeAmount: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  inputReferenceAmountMinusFee: number;

  @Column({ type: 'float', nullable: true })
  minFeeAmount: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  minFeeAmountFiat: number; //outputReferenceAsset

  @Column({ type: 'float', nullable: true })
  totalFeeAmount: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  totalFeeAmountChf: number;

  // Fail
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

  // Transaction details
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

  @Column({ default: false })
  isComplete: boolean;

  //*** FACTORY METHODS ***//

  static createFromPayIn(payIn: CryptoInput, sellRoute: Sell): BuyFiat {
    const entity = new BuyFiat();

    entity.cryptoInput = payIn;
    entity.sell = sellRoute;

    return entity;
  }

  addAmlCheck(amlCheck: CheckStatus): this {
    this.amlCheck = amlCheck;

    return this;
  }

  offRampInitiated(recipientMail: string): UpdateResult<BuyFiat> {
    this.recipientMail = recipientMail;
    this.mail1SendDate = new Date();

    return [this.id, { recipientMail: this.recipientMail, mail1SendDate: this.mail1SendDate }];
  }

  pendingMail(): UpdateResult<BuyFiat> {
    this.recipientMail = this.sell.user.userData.mail;
    this.mail2SendDate = new Date();

    return [this.id, { recipientMail: this.recipientMail, mail2SendDate: this.mail2SendDate }];
  }

  returnMail(): UpdateResult<BuyFiat> {
    const update: Partial<BuyFiat> = {
      recipientMail: this.sell.user.userData.mail,
      mailReturnSendDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  cryptoExchangedToFiat(): UpdateResult<BuyFiat> {
    this.mail2SendDate = new Date();

    return [this.id, { mail2SendDate: this.mail2SendDate }];
  }

  fiatToBankTransferInitiated(): UpdateResult<BuyFiat> {
    this.mail3SendDate = new Date();

    return [this.id, { mail3SendDate: this.mail3SendDate }];
  }

  resetAmlCheck(): UpdateResult<BuyFiat> {
    const update: Partial<BuyFiat> = {
      amlCheck: null,
      amlReason: null,
      mail2SendDate: null,
      mail3SendDate: null,
      percentFee: null,
      inputReferenceAmountMinusFee: null,
      percentFeeAmount: null,
      absoluteFeeAmount: null,
      amountInChf: null,
      amountInEur: null,
      outputReferenceAmount: null,
      outputReferenceAsset: null,
      outputAmount: null,
      outputAsset: null,
      minFeeAmount: null,
      minFeeAmountFiat: null,
      totalFeeAmount: null,
      totalFeeAmountChf: null,
      usedRef: null,
      refProvision: null,
      refFactor: null,
      fiatOutput: null,
      outputDate: null,
      info: null,
      bankFinishTimestamp: null,
      bankStartTimestamp: null,
      bankBatchId: null,
      usedBank: null,
      instantSepa: null,
      remittanceInfo: null,
      cryptoReturnTxId: null,
      cryptoReturnDate: null,
      mailReturnSendDate: null,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get exchangeRateString(): string {
    return `${Util.round(
      (this.outputAmount / this.inputReferenceAmountMinusFee) * (this.inputReferenceAmount / this.inputAmount),
      2,
    )} ${this.outputAsset}/${this.inputAsset}`;
  }

  get percentFeeString(): string {
    return `${Util.round(this.percentFee * 100, 2)}%`;
  }

  get cryptoInputBlockchain(): Blockchain {
    return this.cryptoInput.asset.blockchain;
  }

  get isLightningTransaction(): boolean {
    return this.cryptoInputBlockchain === Blockchain.LIGHTNING;
  }
}

export const BuyFiatAmlReasonPendingStates = [
  AmlReason.DAILY_LIMIT,
  AmlReason.ANNUAL_LIMIT,
  AmlReason.ANNUAL_LIMIT_WITHOUT_KYC,
  AmlReason.NAME_CHECK_WITHOUT_KYC,
];
