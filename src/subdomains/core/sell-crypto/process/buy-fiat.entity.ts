import { ConflictException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Fee } from 'src/subdomains/supporting/payment/entities/fee.entity';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
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
  inputReferenceAmount: number; // deprecated

  @Column({ length: 256, nullable: true })
  inputReferenceAsset: string; // deprecated

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
  usedFees: string; // Semicolon separated id's

  @Column({ type: 'float', nullable: true })
  percentFee: number;

  @Column({ type: 'float', nullable: true })
  percentFeeAmount: number; //inputAsset

  @Column({ type: 'float', nullable: true })
  absoluteFeeAmount: number; //inputAsset

  @Column({ type: 'float', nullable: true })
  inputReferenceAmountMinusFee: number;

  @Column({ type: 'float', nullable: true })
  minFeeAmount: number; //inputAsset

  @Column({ type: 'float', nullable: true })
  minFeeAmountFiat: number; //EUR

  @Column({ type: 'float', nullable: true })
  totalFeeAmount: number; //inputAsset

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

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  outputReferenceAssetEntity: Fiat;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  outputAssetEntity: Fiat;

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

  @OneToOne(() => TransactionRequest, { nullable: true })
  @JoinColumn()
  transactionRequest: TransactionRequest;

  @Column({ length: 256, nullable: true })
  externalTransactionId: string;

  // --- ENTITY METHODS --- //

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

  setFeeAndFiatReference(
    amountInEur: number,
    amountInChf: number,
    fees: Fee[],
    feeRate: number,
    fixedFee: number,
    payoutRefBonus: boolean,
    minFeeAmount: number,
    minFeeAmountFiat: number,
    totalFeeAmount: number,
    totalFeeAmountChf: number,
  ): UpdateResult<BuyFiat> {
    const update: Partial<BuyFiat> = {
      absoluteFeeAmount: fixedFee,
      percentFee: feeRate,
      percentFeeAmount: feeRate * this.inputReferenceAmount,
      minFeeAmount,
      minFeeAmountFiat,
      totalFeeAmount,
      totalFeeAmountChf,
      inputReferenceAmountMinusFee: this.inputReferenceAmount - totalFeeAmount,
      amountInEur,
      amountInChf,
      refFactor: payoutRefBonus ? this.refFactor : 0,
      usedFees: fees?.map((fee) => fee.id).join(';'),
    };

    if (update.inputReferenceAmountMinusFee < 0) throw new ConflictException('InputReferenceAmountMinusFee smaller 0');

    Object.assign(this, update);

    return [this.id, update];
  }

  setOutput(outputAmount: number, outputAssetEntity: Fiat): UpdateResult<BuyFiat> {
    const update: Partial<BuyFiat> = {
      outputAmount,
      outputReferenceAmount: outputAmount,
      outputAssetEntity,
      outputReferenceAssetEntity: outputAssetEntity,
    };

    Object.assign(this, update);

    return [this.id, update];
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
      outputReferenceAssetEntity: null,
      outputAmount: null,
      outputAssetEntity: null,
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

  get exchangeRate(): { exchangeRate: number; rate: number } {
    return {
      exchangeRate: Util.roundByPrecision(
        (this.inputAmount / this.inputReferenceAmount) * (this.inputReferenceAmountMinusFee / this.outputAmount),
        5,
      ),
      rate: Util.roundByPrecision(this.inputAmount / this.outputAmount, 5),
    };
  }

  get exchangeRateString(): string {
    return `${Util.round(1 / this.exchangeRate.exchangeRate, 2)} ${this.outputAssetEntity.name}/${this.inputAsset}`;
  }

  get percentFeeString(): string {
    return Util.toPercent(this.percentFee);
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
