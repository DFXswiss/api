import { ConflictException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { AmlService } from 'src/subdomains/core/aml/aml.service';
import { AmlPendingError } from 'src/subdomains/core/aml/enums/aml-error.enum';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { SpecialExternalBankAccount } from 'src/subdomains/supporting/bank/special-external-bank-account/special-external-bank-account.entity';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import { MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import {
  CryptoPaymentMethod,
  FiatPaymentMethod,
  PaymentMethod,
} from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { Fee } from 'src/subdomains/supporting/payment/entities/fee.entity';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { AmlReason } from '../../../aml/enums/aml-reason.enum';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { Buy } from '../../routes/buy/buy.entity';
import { BuyCryptoBatch } from './buy-crypto-batch.entity';
import { BuyCryptoFee } from './buy-crypto-fees.entity';

export enum BuyCryptoStatus {
  CREATED = 'Created',
  PREPARED = 'Prepared',
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

  @ManyToOne(() => CryptoRoute, (cryptoRoute) => cryptoRoute.buyCryptos, { nullable: true })
  cryptoRoute: CryptoRoute;

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
  inputReferenceAmountMinusFee: number;

  // Fail
  @Column({ type: 'datetime2', nullable: true })
  chargebackDate: Date;

  @Column({ length: 256, nullable: true })
  chargebackRemittanceInfo: string;

  @Column({ length: 256, nullable: true })
  chargebackCryptoTxId: string;

  // Pass
  @Column({ type: 'float', nullable: true })
  outputReferenceAmount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputReferenceAsset: Asset;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputAsset: Asset;

  // Transaction details
  @Column({ length: 256, nullable: true })
  txId: string;

  @Column({ type: 'datetime2', nullable: true })
  outputDate: Date;

  @Column({ length: 256, nullable: true })
  status: BuyCryptoStatus;

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

  defineAssetExchangePair(): { outputReferenceAssetName: string; type: AssetType } | null {
    this.outputAsset = this.target?.asset;

    if (this.outputAsset?.type === AssetType.CUSTOM) return null;

    if (this.outputAsset.dexName === this.inputReferenceAsset) {
      this.setOutputReferenceAsset(this.outputAsset);

      return null;
    }

    switch (this.target.asset.blockchain) {
      case Blockchain.ETHEREUM:
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.POLYGON:
      case Blockchain.BASE:
      case Blockchain.BINANCE_SMART_CHAIN:
      case Blockchain.MONERO:
        this.setOutputReferenceAsset(this.outputAsset);
        return null;

      default:
        return {
          outputReferenceAssetName: 'BTC',
          type: [Blockchain.BITCOIN, Blockchain.LIGHTNING].includes(this.target.asset.blockchain)
            ? AssetType.COIN
            : AssetType.TOKEN,
        };
    }
  }

  setOutputReferenceAsset(asset: Asset): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      outputReferenceAsset: asset,
      status: BuyCryptoStatus.PREPARED,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  calculateOutputReferenceAmount(price: Price): this {
    this.outputReferenceAmount = price.convert(this.inputReferenceAmountMinusFee, 8);
    return this;
  }

  assignCandidateBatch(batch: BuyCryptoBatch): this {
    this.batch = batch;

    return this;
  }

  setFeeConstraints(fee: BuyCryptoFee): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      fee,
    };

    Object.assign(this, update);

    return [this.id, update];
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
      recipientMail: this.userData.mail,
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
    fees: Fee[],
    feeRate: number,
    fixedFee: number,
    payoutRefBonus: boolean,
    minFeeAmount: number,
    minFeeAmountFiat: number,
    totalFeeAmount: number,
    totalFeeAmountChf: number,
  ): UpdateResult<BuyCrypto> {
    const { usedRef, refProvision } = this.user.specifiedRef;

    const update: Partial<BuyCrypto> = {
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
      usedRef,
      refProvision,
      refFactor: !payoutRefBonus || usedRef === '000-000' ? 0 : 1,
      usedFees: fees?.map((fee) => fee.id).join(';'),
    };

    if (update.inputReferenceAmountMinusFee < 0) throw new ConflictException('InputReferenceAmountMinusFee smaller 0');

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
    blacklist: SpecialExternalBankAccount[],
    instantBanks: Bank[],
  ): UpdateResult<BuyCrypto> {
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
      instantBanks,
    );

    const comment = amlErrors.join(';');
    const update: Partial<BuyCrypto> =
      amlErrors.length === 0
        ? { amlCheck: CheckStatus.PASS }
        : amlErrors.every((e) => AmlPendingError.includes(e))
        ? { amlCheck: CheckStatus.PENDING, amlReason: AmlReason.MANUAL_CHECK }
        : Util.minutesDiff(this.created) >= 10
        ? { amlCheck: CheckStatus.GSHEET, comment }
        : { comment };

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
      outputReferenceAsset: null,
      outputAmount: null,
      outputAsset: null,
      txId: null,
      outputDate: null,
      recipientMail: null,
      status: null,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get isLightningOutput(): boolean {
    return this.target.asset.blockchain === Blockchain.LIGHTNING;
  }

  get isLightningInput(): boolean {
    return this.cryptoInput?.asset.blockchain === Blockchain.LIGHTNING;
  }

  get isCryptoCryptoTransaction(): boolean {
    return this.cryptoInput != null;
  }

  get isBankInput(): boolean {
    return this.bankTx != null;
  }

  get exchangeRate(): { exchangeRate: number; rate: number } {
    const exchangeRate =
      (this.inputAmount / this.inputReferenceAmount) * (this.inputReferenceAmountMinusFee / this.outputAmount);
    const rate = this.inputAmount / this.outputAmount;

    return {
      exchangeRate: this.isCryptoCryptoTransaction
        ? Util.roundByPrecision(exchangeRate, 5)
        : Util.round(exchangeRate, 2),
      rate: this.isCryptoCryptoTransaction ? Util.roundByPrecision(rate, 5) : Util.round(rate, 2),
    };
  }

  get exchangeRateString(): string {
    const amount = this.isCryptoCryptoTransaction
      ? Util.roundByPrecision(this.exchangeRate.exchangeRate, 5)
      : Util.round(this.exchangeRate.exchangeRate, 2);
    return `${amount} ${this.inputAsset}/${this.outputAsset.name}`;
  }

  get translationReturnMailKey(): MailTranslationKey {
    if (!this.isCryptoCryptoTransaction) return MailTranslationKey.FIAT_RETURN;
    return MailTranslationKey.CRYPTO_RETURN;
  }

  get user(): User {
    return this.buy ? this.buy.user : this.cryptoRoute.user;
  }

  get userData(): UserData {
    return this.user.userData;
  }

  get route(): Buy | CryptoRoute {
    return this.buy ?? this.cryptoRoute;
  }

  get paymentMethodIn(): PaymentMethod {
    return this.checkoutTx ? FiatPaymentMethod.CARD : this.bankTx ? FiatPaymentMethod.BANK : CryptoPaymentMethod.CRYPTO;
  }

  get target(): { address: string; asset: Asset; trimmedReturnAddress: string } {
    return this.buy
      ? {
          address: this.buy.deposit?.address ?? this.buy.user.address,
          asset: this.buy.asset,
          trimmedReturnAddress: this.buy?.iban ? Util.blankStart(this.buy.iban) : null,
        }
      : {
          address: this.cryptoRoute.targetDeposit?.address ?? this.cryptoRoute.user.address,
          asset: this.cryptoRoute.asset,
          trimmedReturnAddress: this.cryptoRoute?.user?.address ? Util.blankStart(this.cryptoRoute.user.address) : null,
        };
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
];

export const BuyCryptoEditableAmlCheck = [CheckStatus.PENDING, CheckStatus.GSHEET];
