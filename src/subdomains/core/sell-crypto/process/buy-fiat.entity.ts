import { ConflictException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { FeeDto, InternalFeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { SpecialExternalAccount } from 'src/subdomains/supporting/payment/entities/special-external-account.entity';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { FiatOutput } from '../../../supporting/fiat-output/fiat-output.entity';
import { Transaction } from '../../../supporting/payment/entities/transaction.entity';
import { AmlService } from '../../aml/aml.service';
import { AmlPendingError } from '../../aml/enums/aml-error.enum';
import { AmlReason } from '../../aml/enums/aml-reason.enum';
import { CheckStatus } from '../../aml/enums/check-status.enum';
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

  @Column({ type: 'float', nullable: true })
  blockchainFee: number;

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
  outputReferenceAsset: Fiat;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  outputAsset: Fiat;

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

  @Column({ length: 'MAX', nullable: true })
  comment: string;

  @OneToOne(() => TransactionRequest, { nullable: true })
  @JoinColumn()
  transactionRequest: TransactionRequest;

  @OneToOne(() => Transaction, { eager: true, nullable: true })
  @JoinColumn()
  transaction: Transaction;

  @Column({ length: 256, nullable: true })
  externalTransactionId: string;

  // --- ENTITY METHODS --- //

  addAmlCheck(amlCheck: CheckStatus): this {
    this.amlCheck = amlCheck;

    return this;
  }

  offRampInitiated(): UpdateResult<BuyFiat> {
    this.recipientMail = this.noCommunication ? null : this.userData.mail;
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
      recipientMail: this.noCommunication ? null : this.sell.user.userData.mail,
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
    fee: InternalFeeDto & FeeDto,
    minFeeAmountFiat: number,
    totalFeeAmountChf: number,
  ): UpdateResult<BuyFiat> {
    const { usedRef, refProvision } = this.user.specifiedRef;

    const update: Partial<BuyFiat> = {
      absoluteFeeAmount: fee.fixed,
      percentFee: fee.rate,
      percentFeeAmount: fee.rate * this.inputReferenceAmount,
      minFeeAmount: fee.min,
      minFeeAmountFiat,
      totalFeeAmount: fee.total,
      totalFeeAmountChf,
      blockchainFee: fee.network,
      inputReferenceAmountMinusFee: this.inputReferenceAmount - fee.total,
      amountInEur,
      amountInChf,
      usedRef,
      refProvision,
      refFactor: !fee.payoutRefBonus || usedRef === '000-000' ? 0 : 1,
      usedFees: fee.fees?.map((fee) => fee.id).join(';'),
    };

    if (update.inputReferenceAmountMinusFee < 0) throw new ConflictException('InputReferenceAmountMinusFee smaller 0');

    Object.assign(this, update);

    return [this.id, update];
  }

  setOutput(outputAmount: number, outputAssetEntity: Fiat): UpdateResult<BuyFiat> {
    const update: Partial<BuyFiat> = {
      outputAmount,
      outputReferenceAmount: outputAmount,
      outputAsset: outputAssetEntity,
      outputReferenceAsset: outputAssetEntity,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  amlCheckAndFillUp(
    chfReferencePrice: Price,
    minVolume: number,
    last24hVolume: number,
    last7dVolume: number,
    last30dVolume: number,
    bankData: BankData,
    blacklist: SpecialExternalAccount[],
  ): UpdateResult<BuyFiat> {
    const amountInChf = chfReferencePrice.convert(this.inputReferenceAmount, 2);

    const amlErrors = AmlService.getAmlErrors(
      this,
      minVolume,
      amountInChf,
      last24hVolume,
      last7dVolume,
      last30dVolume,
      bankData,
      blacklist,
    );

    const comment = amlErrors.join(';');
    const update: Partial<BuyFiat> =
      amlErrors.length === 0
        ? { amlCheck: CheckStatus.PASS, amlReason: AmlReason.NA }
        : amlErrors.every((e) => AmlPendingError.includes(e))
        ? { amlCheck: CheckStatus.PENDING, amlReason: AmlReason.MANUAL_CHECK }
        : Util.minutesDiff(this.created) >= 10
        ? { amlCheck: CheckStatus.GSHEET, comment }
        : { comment };

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

  get exchangeRate(): { exchangeRate: number; rate: number } {
    return {
      exchangeRate: Util.roundReadable(
        (this.inputAmount / this.inputReferenceAmount) * (this.inputReferenceAmountMinusFee / this.outputAmount),
        false,
      ),
      rate: Util.roundReadable(this.inputAmount / this.outputAmount, false),
    };
  }

  get exchangeRateString(): string {
    return `${Util.roundReadable(1 / this.exchangeRate.exchangeRate, true)} ${this.outputAsset.name}/${
      this.inputAsset
    }`;
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

  get user(): User {
    return this.sell.user;
  }

  get userData(): UserData {
    return this.user.userData;
  }

  get route(): Sell {
    return this.sell;
  }

  get target(): { address: string; asset: Fiat; trimmedReturnAddress: string } {
    return {
      address: this.sell.iban,
      asset: this.sell.fiat,
      trimmedReturnAddress: this.user ? Util.blankStart(this.user.address) : null,
    };
  }

  get noCommunication(): boolean {
    return this.amlReason === AmlReason.NO_COMMUNICATION;
  }
}

export const BuyFiatAmlReasonPendingStates = [
  AmlReason.DAILY_LIMIT,
  AmlReason.ANNUAL_LIMIT,
  AmlReason.ANNUAL_LIMIT_WITHOUT_KYC,
  AmlReason.NAME_CHECK_WITHOUT_KYC,
  AmlReason.HIGH_RISK_KYC_NEEDED,
  AmlReason.MANUAL_CHECK,
];

export const BuyFiatEditableAmlCheck = [CheckStatus.PENDING, CheckStatus.GSHEET];
