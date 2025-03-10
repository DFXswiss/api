import { Active } from 'src/shared/models/active';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Country } from 'src/shared/models/country/country.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { AmountType, Util } from 'src/shared/utils/util';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { FeeDto, InternalFeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import {
  CryptoPaymentMethod,
  FiatPaymentMethod,
  PaymentMethod,
} from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { SpecialExternalAccount } from 'src/subdomains/supporting/payment/entities/special-external-account.entity';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { FiatOutput } from '../../../supporting/fiat-output/fiat-output.entity';
import { Transaction } from '../../../supporting/payment/entities/transaction.entity';
import { AmlReason } from '../../aml/enums/aml-reason.enum';
import { CheckStatus } from '../../aml/enums/check-status.enum';
import { AmlHelperService } from '../../aml/services/aml-helper.service';
import { PaymentLinkPayment } from '../../payment-link/entities/payment-link-payment.entity';
import { Sell } from '../route/sell.entity';

@Entity()
export class BuyFiat extends IEntity {
  // References
  @OneToOne(() => CryptoInput, { nullable: false })
  @JoinColumn()
  cryptoInput: CryptoInput;

  @ManyToOne(() => FiatOutput, (o) => o.buyFiats, { nullable: true })
  fiatOutput?: FiatOutput;

  @ManyToOne(() => Sell, (sell) => sell.buyFiats, { nullable: false })
  sell: Sell;

  @ManyToOne(() => BankTx, { nullable: true })
  bankTx?: BankTx;

  @ManyToOne(() => BankData, { nullable: true })
  bankData?: BankData;

  // Mail
  @Column({ length: 256, nullable: true })
  recipientMail?: string;

  @Column({ type: 'datetime2', nullable: true })
  mail1SendDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  mail2SendDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  mail3SendDate?: Date;

  // Pricing
  @Column({ type: 'float', nullable: true })
  inputAmount?: number;

  @Column({ length: 256, nullable: true })
  inputAsset?: string;

  @Column({ type: 'float', nullable: true })
  inputReferenceAmount?: number; // deprecated

  @Column({ length: 256, nullable: true })
  inputReferenceAsset?: string; // deprecated

  @Column({ type: 'float', nullable: true })
  amountInChf?: number;

  @Column({ type: 'float', nullable: true })
  amountInEur?: number;

  // Ref
  @Column({ length: 256, nullable: true })
  usedRef?: string;

  @Column({ type: 'float', nullable: true })
  refProvision?: number;

  @Column({ type: 'float', nullable: true })
  refFactor?: number;

  // Check
  @Column({ length: 256, nullable: true })
  amlCheck?: CheckStatus;

  @Column({ length: 256, nullable: true })
  amlReason?: AmlReason;

  @Column({ nullable: true })
  highRisk?: boolean;

  @Column({ length: 256, nullable: true })
  amlResponsible?: string;

  // Fee
  @Column({ length: 256, nullable: true })
  usedFees?: string; // Semicolon separated id's

  @Column({ type: 'float', nullable: true })
  percentFee?: number;

  @Column({ type: 'float', nullable: true })
  bankFeeAmount?: number; //inputAsset

  @Column({ type: 'float', nullable: true })
  percentFeeAmount?: number; //inputAsset

  @Column({ type: 'float', nullable: true })
  absoluteFeeAmount?: number; //inputAsset

  @Column({ type: 'float', nullable: true })
  inputReferenceAmountMinusFee?: number;

  @Column({ type: 'float', nullable: true })
  minFeeAmount?: number; //inputAsset

  @Column({ type: 'float', nullable: true })
  minFeeAmountFiat?: number; //EUR

  @Column({ type: 'float', nullable: true })
  totalFeeAmount?: number; //inputAsset

  @Column({ type: 'float', nullable: true })
  totalFeeAmountChf?: number;

  @Column({ type: 'float', nullable: true })
  blockchainFee?: number; //inputAsset

  @Column({ type: 'float', nullable: true })
  paymentLinkFee?: number;

  // Fail
  @Column({ length: 256, nullable: true })
  chargebackTxId?: string;

  @Column({ type: 'datetime2', nullable: true })
  chargebackDate?: Date;

  @Column({ length: 256, nullable: true })
  chargebackAddress?: string;

  @Column({ type: 'datetime2', nullable: true })
  mailReturnSendDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  chargebackAllowedDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  chargebackAllowedDateUser?: Date;

  @Column({ type: 'float', nullable: true })
  chargebackAmount?: number;

  @Column({ length: 256, nullable: true })
  chargebackAllowedBy?: string;

  // Pass
  @Column({ type: 'datetime2', nullable: true })
  priceDefinitionAllowedDate?: Date;

  @Column({ type: 'float', nullable: true })
  outputReferenceAmount?: number;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  outputReferenceAsset?: Fiat;

  @Column({ type: 'float', nullable: true })
  outputAmount?: number;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  outputAsset?: Fiat;

  @Column({ length: 'MAX', nullable: true })
  priceSteps?: string;

  // Transaction details
  @Column({ length: 256, nullable: true })
  remittanceInfo?: string;

  @Column({ nullable: true })
  instantSepa?: boolean;

  @Column({ length: 256, nullable: true })
  usedBank?: string;

  @Column({ type: 'float', nullable: true })
  bankBatchId?: number;

  @Column({ type: 'datetime2', nullable: true })
  bankStartTimestamp?: Date;

  @Column({ type: 'datetime2', nullable: true })
  bankFinishTimestamp?: Date;

  @Column({ length: 256, nullable: true })
  info?: string;

  @Column({ type: 'datetime2', nullable: true })
  outputDate?: Date;

  @Column({ default: false })
  isComplete: boolean;

  @Column({ length: 'MAX', nullable: true })
  comment?: string;

  @OneToOne(() => Transaction, { eager: true, nullable: false })
  @JoinColumn()
  transaction: Transaction;

  // --- ENTITY METHODS --- //

  pendingMail(): UpdateResult<BuyFiat> {
    const update: Partial<BuyFiat> = {
      recipientMail: this.noCommunication ? null : this.userData.mail,
      mail2SendDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  chargebackMail(): UpdateResult<BuyFiat> {
    const update: Partial<BuyFiat> = {
      recipientMail: this.noCommunication ? null : this.userData.mail,
      mailReturnSendDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  fiatToBankTransferInitiated(): UpdateResult<BuyFiat> {
    const update: Partial<BuyFiat> = {
      recipientMail: this.noCommunication ? null : this.userData.mail,
      mail3SendDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  chargebackFillUp(
    chargebackAddress: string,
    chargebackAmount: number,
    chargebackAllowedDate: Date,
    chargebackAllowedDateUser: Date,
    chargebackAllowedBy: string,
    blockchainFee?: number,
  ): UpdateResult<BuyFiat> {
    const update: Partial<BuyFiat> = {
      chargebackDate: chargebackAllowedDate ? new Date() : null,
      chargebackAllowedDate,
      chargebackAllowedDateUser,
      chargebackAddress,
      chargebackAmount,
      chargebackAllowedBy,
      amlCheck: CheckStatus.FAIL,
      mailReturnSendDate: null,
      blockchainFee,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  setFeeAndFiatReference(
    fee: InternalFeeDto & FeeDto,
    minFeeAmountFiat: number,
    totalFeeAmountChf: number,
  ): UpdateResult<BuyFiat> {
    const { usedRef, refProvision } = this.user.specifiedRef;
    const inputReferenceAmountMinusFee = this.inputReferenceAmount - fee.total;

    const update: Partial<BuyFiat> =
      inputReferenceAmountMinusFee < 0
        ? { amlCheck: CheckStatus.FAIL, amlReason: AmlReason.FEE_TOO_HIGH }
        : {
            absoluteFeeAmount: fee.fixed,
            percentFee: fee.rate,
            percentFeeAmount: fee.rate * this.inputReferenceAmount,
            minFeeAmount: fee.min,
            minFeeAmountFiat,
            totalFeeAmount: fee.total,
            totalFeeAmountChf,
            blockchainFee: fee.network,
            bankFeeAmount: fee.bank,
            inputReferenceAmountMinusFee,
            usedRef,
            refProvision,
            refFactor: !fee.payoutRefBonus || usedRef === '000-000' ? 0 : 1,
            usedFees: fee.fees?.map((fee) => fee.id).join(';'),
          };

    Object.assign(this, update);

    return [this.id, update];
  }

  setPaymentLinkPayment(
    amountInEur: number,
    amountInChf: number,
    feeRate: number,
    totalFee: number,
    totalFeeAmountChf: number,
    inputReferenceAmountMinusFee: number,
    outputReferenceAmount: number,
    paymentLinkFee: number,
    priceSteps: PriceStep[],
  ): UpdateResult<BuyFiat> {
    this.priceStepsObject = [...this.priceStepsObject, ...(priceSteps ?? [])];

    const paymentLinkFeeAmount = Util.roundReadable(outputReferenceAmount * paymentLinkFee, AmountType.FIAT_FEE);

    const update: Partial<BuyFiat> =
      inputReferenceAmountMinusFee < 0
        ? { amlCheck: CheckStatus.FAIL, amlReason: AmlReason.FEE_TOO_HIGH }
        : {
            absoluteFeeAmount: 0,
            minFeeAmount: 0,
            minFeeAmountFiat: 0,
            blockchainFee: 0,
            percentFee: feeRate,
            percentFeeAmount: totalFee,
            totalFeeAmount: totalFee,
            totalFeeAmountChf,
            paymentLinkFee,
            inputReferenceAmountMinusFee,
            amountInEur,
            amountInChf,
            usedRef: '000-000',
            refProvision: 0,
            refFactor: 0,
            usedFees: null,
            outputAmount: Util.roundReadable(outputReferenceAmount - paymentLinkFeeAmount, AmountType.FIAT),
            outputReferenceAmount,
            priceSteps: this.priceSteps,
          };

    Object.assign(this, update);

    return [this.id, update];
  }

  setOutput(outputAmount: number, priceSteps: PriceStep[]): UpdateResult<BuyFiat> {
    this.priceStepsObject = [...this.priceStepsObject, ...(priceSteps ?? [])];

    const update: Partial<BuyFiat> = {
      outputAmount,
      outputReferenceAmount: this.outputReferenceAmount ?? outputAmount,
      priceSteps: this.priceSteps,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  complete(remittanceInfo: string, outputDate: Date, bankTx: BankTx): UpdateResult<BuyFiat> {
    const update: Partial<BuyFiat> = {
      remittanceInfo,
      outputDate,
      bankTx,
      isComplete: true,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  amlCheckAndFillUp(
    inputAsset: Active,
    minVolume: number,
    amountInEur: number,
    amountInChf: number,
    last30dVolume: number,
    last365dVolume: number,
    bankData: BankData,
    blacklist: SpecialExternalAccount[],
    ibanCountry: Country,
  ): UpdateResult<BuyFiat> {
    const update: Partial<BuyFiat> = {
      ...AmlHelperService.getAmlResult(
        this,
        inputAsset,
        minVolume,
        amountInChf,
        0,
        last30dVolume,
        last365dVolume,
        bankData,
        blacklist,
        ibanCountry,
      ),
      amountInChf,
      amountInEur,
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
      outputAmount: null,
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
      chargebackTxId: null,
      chargebackDate: null,
      mailReturnSendDate: null,
      comment: null,
      chargebackAddress: null,
      chargebackAllowedDate: null,
      chargebackAllowedDateUser: null,
      chargebackAmount: null,
      chargebackAllowedBy: null,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  pendingInputAmount(asset: Asset): number {
    return !this.outputAmount && this.cryptoInput.asset.id === asset.id ? this.inputAmount : 0;
  }

  pendingOutputAmount(asset: Asset): number {
    return this.outputAmount &&
      asset.dexName === this.sell.fiat.name &&
      (asset.blockchain as string) === 'MaerkiBaumann'
      ? this.outputAmount
      : 0;
  }

  get feeAmountChf(): number {
    return this.totalFeeAmountChf;
  }

  get chargebackBankFee(): number {
    return 0;
  }
  
  get wallet(): Wallet {
    return this.user.wallet;
  }

  get exchangeRate(): { exchangeRate: number; rate: number } {
    return {
      exchangeRate: Util.roundReadable(
        (this.inputAmount / this.inputReferenceAmount) * (this.inputReferenceAmountMinusFee / this.outputAmount),
        AmountType.ASSET,
      ),
      rate: Util.roundReadable(this.inputAmount / this.outputAmount, AmountType.ASSET),
    };
  }

  get user(): User {
    return this.transaction.user;
  }

  get userData(): UserData {
    return this.transaction.userData;
  }

  set userData(userData: UserData) {
    this.transaction.userData = userData;
  }

  get noCommunication(): boolean {
    return this.amlReason === AmlReason.NO_COMMUNICATION;
  }

  get inputMailTranslationKey(): MailTranslationKey {
    return MailTranslationKey.CRYPTO_INPUT;
  }

  get priceStepsObject(): PriceStep[] {
    return this.priceSteps ? JSON.parse(this.priceSteps) : [];
  }

  set priceStepsObject(priceSteps: PriceStep[]) {
    this.priceSteps = JSON.stringify(priceSteps);
  }

  get paymentLinkPayment(): PaymentLinkPayment | undefined {
    return this.cryptoInput?.paymentLinkPayment;
  }

  get paymentMethodIn(): PaymentMethod {
    return CryptoPaymentMethod.CRYPTO;
  }

  get paymentMethodOut(): PaymentMethod {
    return FiatPaymentMethod.BANK;
  }
}

export const BuyFiatAmlReasonPendingStates = [
  AmlReason.MONTHLY_LIMIT,
  AmlReason.ANNUAL_LIMIT,
  AmlReason.ANNUAL_LIMIT_WITHOUT_KYC,
  AmlReason.NAME_CHECK_WITHOUT_KYC,
  AmlReason.HIGH_RISK_KYC_NEEDED,
  AmlReason.MANUAL_CHECK,
  AmlReason.ASSET_KYC_NEEDED,
  AmlReason.VIDEO_IDENT_NEEDED,
];

export const BuyFiatEditableAmlCheck = [CheckStatus.PENDING, CheckStatus.GSHEET, CheckStatus.FAIL];
