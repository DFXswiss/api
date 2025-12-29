import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Active } from 'src/shared/models/active';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Country } from 'src/shared/models/country/country.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { AmountType, Util } from 'src/shared/utils/util';
import { AmlHelperService } from 'src/subdomains/core/aml/services/aml-helper.service';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { CustodyOrder } from 'src/subdomains/core/custody/entities/custody-order.entity';
import { LiquidityManagementPipeline } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-pipeline.entity';
import { LiquidityManagementPipelineStatus } from 'src/subdomains/core/liquidity-management/enums';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { VirtualIban } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.entity';
import { FiatOutput } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
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
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
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
  STOPPED = 'Stopped',
}

@Entity()
export class BuyCrypto extends IEntity {
  // References
  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  bankTx?: BankTx;

  @OneToOne(() => CheckoutTx, { nullable: true })
  @JoinColumn()
  checkoutTx?: CheckoutTx;

  @ManyToOne(() => Buy, (buy) => buy.buyCryptos, { nullable: true })
  buy?: Buy;

  @OneToOne(() => CryptoInput, { nullable: true })
  @JoinColumn()
  cryptoInput?: CryptoInput;

  @ManyToOne(() => Swap, (cryptoRoute) => cryptoRoute.buyCryptos, { nullable: true })
  cryptoRoute?: Swap;

  @ManyToOne(() => BuyCryptoBatch, (batch) => batch.transactions, { eager: true, nullable: true })
  batch?: BuyCryptoBatch;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  chargebackBankTx?: BankTx;

  @OneToOne(() => BuyCryptoFee, (fee) => fee.buyCrypto, { eager: true, cascade: true })
  fee: BuyCryptoFee;

  @ManyToOne(() => BankData, { nullable: true })
  bankData?: BankData;

  @ManyToOne(() => LiquidityManagementPipeline, (liquidityPipeline) => liquidityPipeline.buyCryptos, { nullable: true })
  liquidityPipeline?: LiquidityManagementPipeline;

  // Mail
  @Column({ length: 256, nullable: true })
  recipientMail?: string;

  @Column({ type: 'datetime2', nullable: true })
  mailSendDate?: Date;

  // Pricing
  @Column({ type: 'float', nullable: true })
  inputAmount?: number;

  @Column({ length: 256, nullable: true })
  inputAsset?: string;

  @Column({ type: 'float', nullable: true })
  inputReferenceAmount?: number;

  @Column({ length: 256, nullable: true })
  inputReferenceAsset?: string;

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

  @Column({ length: 256, nullable: true })
  amlResponsible?: string;

  // Check
  @Column({ length: 256, nullable: true })
  amlCheck?: CheckStatus;

  @Column({ length: 256, nullable: true })
  amlReason?: AmlReason;

  @Column({ nullable: true })
  highRisk?: boolean;

  // Fee
  @Column({ length: 256, nullable: true })
  usedFees?: string; // Semicolon separated id's

  @Column({ type: 'float', nullable: true })
  percentFee?: number;

  @Column({ type: 'float', nullable: true })
  bankFeeAmount?: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  percentFeeAmount?: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  minFeeAmount?: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  minFeeAmountFiat?: number; //inputReferenceAsset if FIAT else EUR

  @Column({ type: 'float', nullable: true })
  totalFeeAmount?: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  totalFeeAmountChf?: number;

  @Column({ type: 'float', nullable: true })
  absoluteFeeAmount?: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  networkStartFeeAmount?: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  networkStartAmount?: number; // networkStartAsset

  @Column({ length: 256, nullable: true })
  networkStartTxId?: string;

  @Column({ length: 256, nullable: true })
  networkStartAsset?: string;

  @Column({ type: 'float', nullable: true })
  inputReferenceAmountMinusFee?: number;

  @Column({ type: 'float', nullable: true })
  blockchainFee?: number; //inputReferenceAsset

  @Column({ type: 'float', nullable: true })
  paymentLinkFee?: number;

  // Fail
  @Column({ type: 'datetime2', nullable: true })
  chargebackDate?: Date;

  @Column({ length: 256, nullable: true })
  chargebackRemittanceInfo?: string;

  @Column({ length: 256, nullable: true })
  chargebackCryptoTxId?: string;

  @Column({ type: 'datetime2', nullable: true })
  chargebackAllowedDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  chargebackAllowedDateUser?: Date;

  @Column({ type: 'float', nullable: true })
  chargebackAmount?: number;

  @Column({ length: 256, nullable: true })
  chargebackAllowedBy?: string;

  @Column({ length: 256, nullable: true })
  chargebackIban?: string;

  @OneToOne(() => FiatOutput, { nullable: true })
  @JoinColumn()
  chargebackOutput?: FiatOutput;

  // Pass
  @Column({ type: 'datetime2', nullable: true })
  priceDefinitionAllowedDate?: Date; // is set for tx with amlCheck = true or for manualPrice calculation for refunds with missingPrice error

  @Column({ type: 'float', nullable: true })
  outputReferenceAmount?: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputReferenceAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  outputAmount?: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputAsset?: Asset;

  @Column({ length: 'MAX', nullable: true })
  priceSteps?: string;

  // Transaction details
  @Column({ length: 256, nullable: true })
  txId?: string;

  @Column({ type: 'datetime2', nullable: true })
  outputDate?: Date;

  @Column({ length: 256, default: BuyCryptoStatus.CREATED })
  status: BuyCryptoStatus;

  @Column({ default: false })
  isComplete: boolean;

  @Column({ length: 'MAX', nullable: true })
  comment?: string;

  @OneToOne(() => Transaction, { eager: true, nullable: false })
  @JoinColumn()
  transaction: Transaction;

  // NOTE: This field is deprecated and no longer actively used.
  // Sift calls are now fire-and-forget to prevent blocking operations.
  // Consider removing in future migration or repurposing for error tracking.
  @Column({ length: 'MAX', nullable: true })
  siftResponse?: string;

  // --- ENTITY METHODS --- //

  calculateOutputReferenceAmount(price: Price): this {
    if (
      Config.exchangeRateFromLiquidityOrder.includes(this.outputAsset.name) &&
      this.liquidityPipeline &&
      ![LiquidityManagementPipelineStatus.FAILED, LiquidityManagementPipelineStatus.STOPPED].includes(
        this.liquidityPipeline.status,
      )
    ) {
      if (
        this.liquidityPipeline.status !== LiquidityManagementPipelineStatus.COMPLETE ||
        !this.liquidityPipeline.orders?.length
      )
        throw new Error('LiquidityPipeline not completed');

      const pipelinePrice = this.liquidityPipeline.orders[0].exchangePrice;
      const filteredPriceSteps = price.steps.slice(0, -1);

      const totalPriceValue = [...filteredPriceSteps, pipelinePrice].reduce((prev, curr) => prev * curr.price, 1);
      const totalPrice = Price.create(this.inputReferenceAsset, this.outputAsset.name, totalPriceValue);

      this.outputReferenceAmount = totalPrice.convert(this.inputReferenceAmountMinusFee, 8);
      this.priceStepsObject = [...this.inputPriceStep, ...filteredPriceSteps, ...pipelinePrice.steps];

      return this;
    }

    this.outputReferenceAmount = price.convert(this.inputReferenceAmountMinusFee, 8);
    this.priceStepsObject = [...this.priceStepsObject, ...this.inputPriceStep, ...price.steps];
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

  setOutputAmount(batchReferenceAmount: number, batchOutputAmount: number): this {
    this.outputAmount = this.calculateOutputAmount(batchReferenceAmount, batchOutputAmount);
    this.status = BuyCryptoStatus.READY_FOR_PAYOUT;

    return this;
  }

  calculateOutputAmount(batchReferenceAmount: number, batchOutputAmount: number): number {
    if (batchReferenceAmount === 0) {
      throw new Error('Cannot calculate outputAmount, provided batchReferenceAmount is 0');
    }

    return Util.round((this.outputReferenceAmount / batchReferenceAmount) * batchOutputAmount, 8);
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

  chargebackFillUp(
    chargebackIban: string,
    chargebackAmount: number,
    chargebackAllowedDate: Date,
    chargebackAllowedDateUser: Date,
    chargebackAllowedBy: string,
    chargebackOutput?: FiatOutput,
    chargebackRemittanceInfo?: string,
    blockchainFee?: number,
  ): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      chargebackDate: chargebackAllowedDate ? new Date() : null,
      chargebackAllowedDate,
      chargebackAllowedDateUser,
      chargebackIban,
      chargebackAmount,
      chargebackOutput,
      chargebackAllowedBy,
      chargebackRemittanceInfo,
      amlCheck: CheckStatus.FAIL,
      mailSendDate: null,
      blockchainFee,
      isComplete: this.checkoutTx && chargebackAllowedDate ? true : undefined,
      status: this.checkoutTx && chargebackAllowedDate ? BuyCryptoStatus.COMPLETE : undefined,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  setFeeAndFiatReference(
    fee: InternalFeeDto & FeeDto,
    minFeeAmountFiat: number,
    totalFeeAmountChf: number,
  ): UpdateResult<BuyCrypto> {
    const { usedRef, refProvision } = this.user.specifiedRef;
    const inputReferenceAmountMinusFee = this.inputReferenceAmount - fee.total;

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
            bankFeeAmount: fee.bank,
            inputReferenceAmountMinusFee,
            usedRef,
            refProvision,
            refFactor: !fee.payoutRefBonus || usedRef === Config.defaultRef ? 0 : 1,
            usedFees: fee.fees?.map((fee) => fee.id).join(';'),
            networkStartFeeAmount: fee.networkStart,
            status: this.status === BuyCryptoStatus.WAITING_FOR_LOWER_FEE ? BuyCryptoStatus.CREATED : undefined,
          };

    Object.assign(this, update);

    return [this.id, update];
  }

  amlCheckAndFillUp(
    inputAsset: Active,
    minVolume: number,
    amountInEur: number,
    amountInChf: number,
    last7dCheckoutVolume: number,
    last30dVolume: number,
    last365dVolume: number,
    bankData: BankData,
    blacklist: SpecialExternalAccount[],
    banks: Bank[],
    ibanCountry: Country,
    refUser?: User,
    ipLogCountries?: string[],
    virtualIban?: VirtualIban,
    multiAccountBankNames?: string[],
  ): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      ...AmlHelperService.getAmlResult(
        this,
        inputAsset,
        minVolume,
        amountInChf,
        last7dCheckoutVolume,
        last30dVolume,
        last365dVolume,
        bankData,
        blacklist,
        ibanCountry,
        refUser,
        banks,
        ipLogCountries,
        virtualIban,
        multiAccountBankNames,
      ),
      amountInChf,
      amountInEur,
    };

    if (
      ((update.amlCheck && update.amlCheck !== this.amlCheck) ||
        (update.amlReason && update.amlReason !== this.amlReason)) &&
      [CheckStatus.FAIL, CheckStatus.PENDING].includes(update.amlCheck) &&
      !DisabledProcess(Process.AML_RECHECK_MAIL_RESET)
    )
      update.mailSendDate = null;

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
      chargebackIban: null,
      chargebackAllowedDate: null,
      chargebackAllowedDateUser: null,
      chargebackAmount: null,
      chargebackAllowedBy: null,
      chargebackOutput: null,
      priceDefinitionAllowedDate: null,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  resetFees(): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      percentFee: null,
      percentFeeAmount: null,
      minFeeAmount: null,
      minFeeAmountFiat: null,
      totalFeeAmount: null,
      totalFeeAmountChf: null,
      blockchainFee: null,
      bankFeeAmount: null,
      inputReferenceAmountMinusFee: null,
      usedRef: null,
      refProvision: null,
      refFactor: null,
      usedFees: null,
      networkStartFeeAmount: null,
      status: null,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  pendingInputAmount(asset: Asset): number {
    if (this.outputAmount) return 0;
    switch (asset.blockchain) {
      case Blockchain.MAERKI_BAUMANN:
      case Blockchain.OLKYPAY:
      case Blockchain.YAPEAL:
        return BankService.isBankMatching(asset, this.bankTx?.accountIban) ? this.inputReferenceAmount : 0;

      case Blockchain.CHECKOUT:
        return this.checkoutTx?.currency === asset.dexName ? this.inputReferenceAmount : 0;

      default:
        return this.cryptoInput?.asset.id === asset.id ? this.inputAmount : 0;
    }
  }

  pendingOutputAmount(asset: Asset): number {
    return this.outputAmount && this.outputAsset.id === asset.id ? this.outputAmount : 0;
  }

  get custodyOrder(): CustodyOrder {
    return this.transaction.custodyOrder ?? this.transaction.request?.custodyOrder;
  }

  get chargebackBankRemittanceInfo(): string {
    return `Buy Chargeback ${this.id} Zahlung kann nicht verarbeitet werden. Weitere Infos unter dfx.swiss/help`;
  }

  get networkStartCorrelationId(): string {
    return `${this.id}-network-start-fee`;
  }

  get refundAmount(): number {
    return this.bankTx ? this.bankTx.refundAmount : this.inputAmount;
  }

  get inputPriceStep(): PriceStep[] {
    return this.inputAsset !== this.inputReferenceAsset
      ? [
          PriceStep.create(
            'Bank',
            this.inputAsset,
            this.inputReferenceAsset,
            this.inputAmount / this.inputReferenceAmount,
          ),
        ]
      : [];
  }

  get feeAmountChf(): number {
    return this.totalFeeAmountChf;
  }

  get isCryptoCryptoTransaction(): boolean {
    return this.cryptoInput != null;
  }

  get exchangeRate(): { exchangeRate: number; rate: number } {
    const exchangeRate =
      (this.inputAmount / this.inputReferenceAmount) * (this.inputReferenceAmountMinusFee / this.outputAmount);
    const rate = this.networkStartAmount
      ? (this.inputAmount / this.inputReferenceAmount) *
        ((this.inputReferenceAmount - this.networkStartFeeAmount) / this.outputAmount)
      : this.inputAmount / this.outputAmount;
    const amountType = this.isCryptoCryptoTransaction ? AmountType.ASSET : AmountType.FIAT;

    return {
      exchangeRate: Util.roundReadable(exchangeRate, amountType),
      rate: Util.roundReadable(rate, amountType),
    };
  }

  get translationReturnMailKey(): MailTranslationKey {
    if (!this.isCryptoCryptoTransaction) return MailTranslationKey.FIAT_CHARGEBACK;
    return MailTranslationKey.CRYPTO_CHARGEBACK;
  }

  get chargebackBankFee(): number {
    return this.bankTx ? this.bankTx.chargebackBankFee : 0;
  }

  get manualChfPrice(): Price {
    return this.amountInChf && this.priceDefinitionAllowedDate
      ? Price.create(PriceCurrency.CHF, this.inputAsset, this.amountInChf / this.inputAmount)
      : undefined;
  }

  get wallet(): Wallet {
    return this.user.wallet;
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

  get route(): Buy | Swap {
    return this.buy ?? this.cryptoRoute;
  }

  get paymentMethodIn(): PaymentMethod {
    return this.checkoutTx ? FiatPaymentMethod.CARD : this.bankTx ? FiatPaymentMethod.BANK : CryptoPaymentMethod.CRYPTO;
  }

  get paymentMethodOut(): PaymentMethod {
    return CryptoPaymentMethod.CRYPTO;
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
      outputReferenceAmount: this.priceStepsObject.some((p) => p.source === Config.manualPriceStepSourceName)
        ? undefined
        : null, // ignore reset when manual payout
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
  AmlReason.MONTHLY_LIMIT,
  AmlReason.ANNUAL_LIMIT,
  AmlReason.ANNUAL_LIMIT_WITHOUT_KYC,
  AmlReason.OLKY_NO_KYC,
  AmlReason.NAME_CHECK_WITHOUT_KYC,
  AmlReason.HIGH_RISK_KYC_NEEDED,
  AmlReason.MANUAL_CHECK,
  AmlReason.MANUAL_CHECK_BANK_DATA,
  AmlReason.ASSET_KYC_NEEDED,
  AmlReason.VIDEO_IDENT_NEEDED,
  AmlReason.KYC_DATA_NEEDED,
  AmlReason.BANK_TX_NEEDED,
  AmlReason.MANUAL_CHECK_PHONE,
  AmlReason.MERGE_INCOMPLETE,
  AmlReason.BANK_RELEASE_PENDING,
  AmlReason.MANUAL_CHECK_IP_PHONE,
  AmlReason.MANUAL_CHECK_IP_COUNTRY_PHONE,
];

export const BuyCryptoEditableAmlCheck = [CheckStatus.PENDING, CheckStatus.GSHEET, CheckStatus.FAIL];
