import { Asset } from 'src/shared/models/asset/asset.entity';
import { Country } from 'src/shared/models/country/country.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { AmlHelperService } from 'src/subdomains/core/aml/aml-helper.service';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import { MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { FeeDto, InternalFeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import {
  CryptoPaymentMethod,
  FiatPaymentMethod,
  PaymentMethod,
} from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { SpecialExternalAccount } from 'src/subdomains/supporting/payment/entities/special-external-account.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { Price, PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { AmlReason } from '../../../aml/enums/aml-reason.enum';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { Buy } from '../../routes/buy/buy.entity';
import { BuyCryptoBatch } from './buy-crypto-batch.entity';
import { BuyCryptoFee } from './buy-crypto-fees.entity';

export enum BuyCryptoStatus {
  CREATED = 'Created',
  PRICE_INVALID = 'PriceInvalid',
  MISSING_LIQUIDITY = 'MissingLiquidity',
  WAITING_FOR_LOWER_FEE = 'WaitingForLowerFee',
  BATCHED = 'Batched',
  PRICE_SLIPPAGE = 'PriceSlippage',
  PENDING_LIQUIDITY = 'PendingLiquidity',
  READY_FOR_PAYOUT = 'ReadyForPayout',
  PAYING_OUT = 'PayingOut',
  COMPLETE = 'Complete',
}

@Entity()
export class BuyCrypto extends IEntity {
  // References
  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  bankTx: BankTx;

  @OneToOne(() => CheckoutTx, { nullable: true })
  @JoinColumn()
  checkoutTx: CheckoutTx;

  @ManyToOne(() => Buy, (buy) => buy.buyCryptos, { nullable: true })
  buy: Buy;

  @OneToOne(() => CryptoInput, { nullable: true })
  @JoinColumn()
  cryptoInput: CryptoInput;

  @ManyToOne(() => Swap, (cryptoRoute) => cryptoRoute.buyCryptos, { nullable: true })
  cryptoRoute: Swap;

  @ManyToOne(() => BuyCryptoBatch, (batch) => batch.transactions, { eager: true, nullable: true })
  batch: BuyCryptoBatch;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  chargebackBankTx: BankTx;

  @OneToOne(() => BuyCryptoFee, (fee) => fee.buyCrypto, { eager: true, cascade: true })
  fee: BuyCryptoFee;

  // Mail
  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @Column({ type: 'datetime2', nullable: true })
  mailSendDate: Date;

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

  @Column({ length: 256, nullable: true })
  amlResponsible: string;

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
  percentFeeAmount: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  minFeeAmount: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  minFeeAmountFiat: number; //inputReferenceAsset if FIAT else EUR

  @Column({ type: 'float', nullable: true })
  totalFeeAmount: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  totalFeeAmountChf: number;

  @Column({ type: 'float', nullable: true })
  absoluteFeeAmount: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  networkStartFeeAmount: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  inputReferenceAmountMinusFee: number;

  @Column({ type: 'float', nullable: true })
  blockchainFee: number;

  // Fail
  @Column({ type: 'datetime2', nullable: true })
  chargebackDate: Date;

  @Column({ length: 256, nullable: true })
  chargebackRemittanceInfo: string;

  @Column({ length: 256, nullable: true })
  chargebackCryptoTxId: string;

  @Column({ type: 'datetime2', nullable: true })
  chargebackAllowedDate: Date;

  // Pass
  @Column({ type: 'datetime2', nullable: true })
  priceDefinitionAllowedDate: Date;

  @Column({ type: 'float', nullable: true })
  outputReferenceAmount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputReferenceAsset: Asset;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputAsset: Asset;

  @Column({ length: 'MAX', nullable: true })
  priceSteps: string;

  // Transaction details
  @Column({ length: 256, nullable: true })
  txId: string;

  @Column({ type: 'datetime2', nullable: true })
  outputDate: Date;

  @Column({ length: 256, default: BuyCryptoStatus.CREATED })
  status: BuyCryptoStatus;

  @Column({ default: false })
  isComplete: boolean;

  @Column({ length: 'MAX', nullable: true })
  comment: string;

  @OneToOne(() => Transaction, { eager: true, nullable: false })
  @JoinColumn()
  transaction: Transaction;

  @Column({ length: 'MAX', nullable: true })
  siftResponse: string;

  // --- ENTITY METHODS --- //

  calculateOutputReferenceAmount(price: Price): this {
    this.outputReferenceAmount = price.convert(this.inputReferenceAmountMinusFee, 8);
    const inputPriceStep =
      this.inputAsset !== this.inputReferenceAsset
        ? [
            PriceStep.create(
              'Bank',
              this.inputAsset,
              this.inputReferenceAsset,
              this.inputAmount / this.inputReferenceAmount,
            ),
          ]
        : [];
    this.priceStepsObject = [...this.priceStepsObject, ...inputPriceStep, ...(price.steps ?? [])];
    return this;
  }

  assignCandidateBatch(batch: BuyCryptoBatch): this {
    this.batch = batch;

    return this;
  }

  setPriceInvalidStatus(): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      status: BuyCryptoStatus.PRICE_INVALID,
      ...this.resetTransaction(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  setPriceSlippageStatus(): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      status: BuyCryptoStatus.PRICE_SLIPPAGE,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  setMissingLiquidityStatus(): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      status: BuyCryptoStatus.MISSING_LIQUIDITY,
      ...this.resetTransaction(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  waitingForLowerFee(): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      status: BuyCryptoStatus.WAITING_FOR_LOWER_FEE,
      ...this.resetTransaction(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  resetTransactionButKeepState(): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      ...this.resetTransaction(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  batched(): this {
    this.status = BuyCryptoStatus.BATCHED;

    return this;
  }

  pendingLiquidity(): this {
    this.status = BuyCryptoStatus.PENDING_LIQUIDITY;

    return this;
  }

  addActualPurchaseFee(txPurchaseFee: number): this {
    this.fee.addActualPurchaseFee(txPurchaseFee, this);

    return this;
  }

  calculateOutputAmount(batchReferenceAmount: number, batchOutputAmount: number): this {
    if (batchReferenceAmount === 0) {
      throw new Error('Cannot calculate outputAmount, provided batchReferenceAmount is 0');
    }

    this.outputAmount = Util.round((this.outputReferenceAmount / batchReferenceAmount) * batchOutputAmount, 8);
    this.status = BuyCryptoStatus.READY_FOR_PAYOUT;

    return this;
  }

  payingOut(): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      status: BuyCryptoStatus.PAYING_OUT,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  setTxId(payoutTxId: string): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      txId: payoutTxId,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  complete(payoutFee: number): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      outputDate: new Date(),
      isComplete: true,
      status: BuyCryptoStatus.COMPLETE,
      fee: this.fee.addActualPayoutFee(payoutFee, this),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  confirmSentMail(): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      recipientMail: this.noCommunication ? null : this.userData.mail,
      mailSendDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  resetSentMail(): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      recipientMail: null,
      mailSendDate: null,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  setFeeAndFiatReference(
    amountInEur: number,
    amountInChf: number,
    fee: InternalFeeDto & FeeDto,
    minFeeAmountFiat: number,
    totalFeeAmountChf: number,
    maxNetworkFee: number,
  ): UpdateResult<BuyCrypto> {
    const { usedRef, refProvision } = this.user.specifiedRef;
    const inputReferenceAmountMinusFee = this.inputReferenceAmount - fee.total;

    const feeConstraints = this.fee ?? BuyCryptoFee.create(this);
    feeConstraints.allowedTotalFeeAmount = maxNetworkFee;

    const update: Partial<BuyCrypto> =
      inputReferenceAmountMinusFee < 0
        ? { amlCheck: CheckStatus.FAIL, amlReason: AmlReason.FEE_TOO_HIGH, mailSendDate: null }
        : {
            absoluteFeeAmount: fee.fixed,
            percentFee: fee.rate,
            percentFeeAmount: fee.rate * this.inputReferenceAmount,
            minFeeAmount: fee.min,
            minFeeAmountFiat,
            totalFeeAmount: fee.total,
            totalFeeAmountChf,
            blockchainFee: fee.network,
            inputReferenceAmountMinusFee,
            amountInEur,
            amountInChf,
            usedRef,
            refProvision,
            refFactor: !fee.payoutRefBonus || usedRef === '000-000' ? 0 : 1,
            usedFees: fee.fees?.map((fee) => fee.id).join(';'),
            fee: feeConstraints,
            networkStartFeeAmount: fee.networkStart,
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
    last365dVolume: number,
    bankData: BankData,
    blacklist: SpecialExternalAccount[],
    instantBanks: Bank[],
    ibanCountry: Country,
  ): UpdateResult<BuyCrypto> {
    const amountInChf = chfReferencePrice.convert(this.inputReferenceAmount, 2);

    const update: Partial<BuyCrypto> = AmlHelperService.getAmlResult(
      this,
      minVolume,
      amountInChf,
      last24hVolume,
      last7dVolume,
      last30dVolume,
      last365dVolume,
      bankData,
      blacklist,
      instantBanks,
      ibanCountry,
    );

    Object.assign(this, update);

    return [this.id, update];
  }

  resetAmlCheck(): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      amlCheck: null,
      amlReason: null,
      mailSendDate: null,
      amountInChf: null,
      amountInEur: null,
      absoluteFeeAmount: null,
      percentFee: null,
      percentFeeAmount: null,
      minFeeAmount: null,
      minFeeAmountFiat: null,
      totalFeeAmount: null,
      totalFeeAmountChf: null,
      inputReferenceAmountMinusFee: null,
      usedRef: null,
      refProvision: null,
      refFactor: null,
      chargebackDate: null,
      chargebackRemittanceInfo: null,
      outputReferenceAmount: null,
      outputAmount: null,
      txId: null,
      outputDate: null,
      recipientMail: null,
      status: BuyCryptoStatus.CREATED,
      comment: null,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get isCryptoCryptoTransaction(): boolean {
    return this.cryptoInput != null;
  }

  get exchangeRate(): { exchangeRate: number; rate: number } {
    const exchangeRate =
      (this.inputAmount / this.inputReferenceAmount) * (this.inputReferenceAmountMinusFee / this.outputAmount);
    const rate = this.inputAmount / this.outputAmount;

    return {
      exchangeRate: Util.roundReadable(exchangeRate, !this.isCryptoCryptoTransaction),
      rate: Util.roundReadable(rate, !this.isCryptoCryptoTransaction),
    };
  }

  get translationReturnMailKey(): MailTranslationKey {
    if (!this.isCryptoCryptoTransaction) return MailTranslationKey.FIAT_RETURN;
    return MailTranslationKey.CRYPTO_RETURN;
  }

  get user(): User {
    return this.transaction.user;
  }

  get userData(): UserData {
    return this.user.userData;
  }

  set userData(userData: UserData) {
    this.user.userData = userData;
  }

  get route(): Buy | Swap {
    return this.buy ?? this.cryptoRoute;
  }

  get paymentMethodIn(): PaymentMethod {
    return this.checkoutTx ? FiatPaymentMethod.CARD : this.bankTx ? FiatPaymentMethod.BANK : CryptoPaymentMethod.CRYPTO;
  }

  get targetAddress(): string {
    return this.buy?.deposit?.address ?? this.cryptoRoute?.targetDeposit?.address ?? this.user.address;
  }

  get noCommunication(): boolean {
    return this.amlReason === AmlReason.NO_COMMUNICATION;
  }

  get inputMailTranslationKey(): MailTranslationKey {
    return this.isCryptoCryptoTransaction ? MailTranslationKey.CRYPTO_INPUT : MailTranslationKey.FIAT_INPUT;
  }

  get priceStepsObject(): PriceStep[] {
    return this.priceSteps ? JSON.parse(this.priceSteps) : [];
  }

  set priceStepsObject(priceSteps: PriceStep[]) {
    this.priceSteps = JSON.stringify(priceSteps);
  }

  get mailReturnReason(): string {
    return [AmlReason.HIGH_RISK_BLOCKED, AmlReason.HIGH_RISK_KYC_NEEDED].includes(this.amlReason) && this.checkoutTx
      ? `${this.amlReason}Checkout`
      : this.amlReason;
  }

  // --- HELPER METHODS --- //

  private resetTransaction(): Partial<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      outputReferenceAmount: null,
      batch: null,
      isComplete: false,
      outputAmount: null,
      outputDate: null,
    };

    Object.assign(this, update);

    return update;
  }
}

export const BuyCryptoAmlReasonPendingStates = [
  AmlReason.DAILY_LIMIT,
  AmlReason.ANNUAL_LIMIT,
  AmlReason.ANNUAL_LIMIT_WITHOUT_KYC,
  AmlReason.OLKY_NO_KYC,
  AmlReason.NAME_CHECK_WITHOUT_KYC,
  AmlReason.HIGH_RISK_KYC_NEEDED,
  AmlReason.MANUAL_CHECK,
  AmlReason.CHARGEBACK_NOT_POSSIBLE_NO_IBAN,
];

export const BuyCryptoEditableAmlCheck = [CheckStatus.PENDING, CheckStatus.GSHEET, CheckStatus.FAIL];
