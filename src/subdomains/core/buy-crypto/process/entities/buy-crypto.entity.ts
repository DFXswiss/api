import { Entity, Column, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { BuyCryptoBatch } from './buy-crypto-batch.entity';
import { Util } from 'src/shared/utils/util';
import { AmlCheck } from '../enums/aml-check.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AmlReason } from '../enums/aml-reason.enum';
import { BuyCryptoFee } from './buy-crypto-fees.entity';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { BankTx } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Buy } from '../../routes/buy/buy.entity';

export enum BuyCryptoStatus {
  CREATED = 'Created',
  PREPARED = 'Prepared',
  PRICE_MISMATCH = 'PriceMismatch',
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
  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  bankTx: BankTx;

  @ManyToOne(() => Buy, (buy) => buy.buyCryptos, { nullable: true })
  buy: Buy;

  @OneToOne(() => CryptoInput, { nullable: true })
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

  @Column({ length: 256, nullable: true })
  amlReason: AmlReason;

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

  @Column({ type: 'float', nullable: true })
  outputReferenceAmount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputReferenceAsset: Asset;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputAsset: Asset;

  @Column({ length: 256, nullable: true })
  txId: string;

  @Column({ default: false })
  isComplete: boolean;

  @Column({ type: 'datetime2', nullable: true })
  outputDate: Date;

  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @Column({ type: 'datetime2', nullable: true })
  mailSendDate: Date;

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

  @OneToOne(() => BuyCryptoFee, (fee) => fee.buyCrypto, { eager: true, cascade: true })
  fee: BuyCryptoFee;

  @Column({ length: 256, nullable: true })
  status: BuyCryptoStatus;

  //*** FACTORY METHODS ***//

  static createFromPayIn(payIn: CryptoInput, cryptoRoute: CryptoRoute): BuyCrypto {
    const entity = new BuyCrypto();

    entity.cryptoInput = payIn;
    entity.cryptoRoute = cryptoRoute;
    entity.status = BuyCryptoStatus.CREATED;

    return entity;
  }

  defineAssetExchangePair(): { outputReferenceAssetName: string; type: AssetType } | null {
    this.outputAsset = this.target?.asset;

    if (this.outputAsset.dexName === this.inputReferenceAsset) {
      this.setOutputReferenceAsset(this.outputAsset);

      return null;
    }

    if (['USDC', 'USDT'].includes(this.outputAsset.dexName)) {
      if (['EUR', 'CHF', 'USD', 'USDC', 'USDT'].includes(this.inputReferenceAsset)) {
        this.setOutputReferenceAsset(this.outputAsset);

        return null;
      } else {
        return {
          outputReferenceAssetName: 'BTC',
          type: this.target.asset.blockchain === Blockchain.BITCOIN ? AssetType.COIN : AssetType.TOKEN,
        };
      }
    }

    switch (this.target.asset.blockchain) {
      case Blockchain.ETHEREUM:
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.BINANCE_SMART_CHAIN:
        this.setOutputReferenceAsset(this.outputAsset);
        return null;

      default:
        return {
          outputReferenceAssetName: 'BTC',
          type: this.target.asset.blockchain === Blockchain.BITCOIN ? AssetType.COIN : AssetType.TOKEN,
        };
    }
  }

  setOutputReferenceAsset(asset: Asset): this {
    this.outputReferenceAsset = asset;
    this.status = BuyCryptoStatus.PREPARED;

    return this;
  }

  calculateOutputReferenceAmount(prices: Price[]): this {
    if (this.inputReferenceAsset === this.outputReferenceAsset.dexName) {
      this.outputReferenceAmount = Util.round(this.inputReferenceAmountMinusFee, 8);
    } else {
      const price = prices.find(
        (p) => p.source === this.inputReferenceAsset && p.target === this.outputReferenceAsset.dexName,
      );

      if (!price) {
        throw new Error(
          `Cannot calculate outputReferenceAmount, ${this.inputReferenceAsset}/${this.outputReferenceAsset.dexName} price is missing`,
        );
      }

      if (!price.price) {
        throw new Error('Cannot calculate outputReferenceAmount, price value is 0');
      }

      this.outputReferenceAmount = Util.round(this.inputReferenceAmountMinusFee / price.price, 8);
    }

    return this;
  }

  assignCandidateBatch(batch: BuyCryptoBatch): this {
    this.batch = batch;

    return this;
  }

  setFeeConstraints(fee: BuyCryptoFee): UpdateResult<BuyCrypto> {
    this.fee = fee;

    return [this.id, { fee: this.fee }];
  }

  setPriceMismatchStatus(): UpdateResult<BuyCrypto> {
    this.status = BuyCryptoStatus.PRICE_MISMATCH;

    return [this.id, { status: this.status, ...this.resetTransaction() }];
  }

  setPriceSlippageStatus(): UpdateResult<BuyCrypto> {
    this.status = BuyCryptoStatus.PRICE_SLIPPAGE;

    return [this.id, { status: this.status }];
  }

  setMissingLiquidityStatus(): UpdateResult<BuyCrypto> {
    this.status = BuyCryptoStatus.MISSING_LIQUIDITY;

    return [this.id, { status: this.status, ...this.resetTransaction() }];
  }

  waitingForLowerFee(): UpdateResult<BuyCrypto> {
    this.status = BuyCryptoStatus.WAITING_FOR_LOWER_FEE;

    return [this.id, { status: this.status, ...this.resetTransaction() }];
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
    this.status = BuyCryptoStatus.PAYING_OUT;

    return [this.id, { status: this.status }];
  }

  complete(payoutTxId: string, payoutFee: number): UpdateResult<BuyCrypto> {
    this.txId = payoutTxId;
    this.outputDate = new Date();
    this.isComplete = true;
    this.status = BuyCryptoStatus.COMPLETE;
    this.fee.addActualPayoutFee(payoutFee, this);

    return [
      this.id,
      { txId: this.txId, outputDate: this.outputDate, isComplete: this.isComplete, status: this.status, fee: this.fee },
    ];
  }

  confirmSentMail(): UpdateResult<BuyCrypto> {
    this.recipientMail = this.user.userData.mail;
    this.mailSendDate = new Date();

    return [this.id, { recipientMail: this.recipientMail, mailSendDate: this.mailSendDate }];
  }

  get translationKey(): string {
    if (this.amlCheck === AmlCheck.PASS) {
      return this.cryptoRoute ? 'mail.payment.deposit.buyCryptoCrypto' : 'mail.payment.deposit.buyCryptoFiat';
    } else if (this.amlCheck === AmlCheck.PENDING) {
      switch (this.amlReason) {
        case AmlReason.DAILY_LIMIT:
          return 'mail.payment.pending.dailyLimit';

        case AmlReason.ANNUAL_LIMIT:
          return 'mail.payment.pending.annualLimit';

        case AmlReason.ANNUAL_LIMIT_WITHOUT_KYC:
          return 'mail.payment.pending.annualLimitWithoutKyc';

        case AmlReason.OLKY_NO_KYC:
          return 'mail.payment.pending.olkyNoKyc';

        case AmlReason.NAME_CHECK_WITHOUT_KYC:
          return 'mail.payment.pending.nameCheckWithoutKyc';
      }
    } else if (this.amlCheck === AmlCheck.FAIL) {
      return 'mail.payment.deposit.paybackInitiated';
    }

    throw new Error(`Tried to send a mail for BuyCrypto ${this.id} in invalid state`);
  }

  get user(): User {
    return this.buy ? this.buy.user : this.cryptoRoute.user;
  }

  get target(): { address: string; asset: Asset; trimmedReturnAddress: string } {
    return this.buy
      ? {
          address: this.buy.deposit?.address ?? this.buy.user.address,
          asset: this.buy.asset,
          trimmedReturnAddress: this.buy?.iban ? Util.blankIban(this.buy.iban) : null,
        }
      : {
          address: this.cryptoRoute.targetDeposit?.address ?? this.cryptoRoute.user.address,
          asset: this.cryptoRoute.asset,
          trimmedReturnAddress: this.cryptoRoute?.user?.address
            ? Util.blankBlockchainAddress(this.cryptoRoute.user.address)
            : null,
        };
  }

  //*** HELPER METHODS ***//

  private resetTransaction(): Partial<BuyCrypto> {
    this.outputReferenceAmount = null;
    this.batch = null;
    this.isComplete = false;
    this.outputAmount = null;
    this.outputDate = null;
    this.mailSendDate = null;
    this.recipientMail = null;

    return {
      outputReferenceAmount: this.outputReferenceAmount,
      batch: this.batch,
      isComplete: this.isComplete,
      outputAmount: this.outputAmount,
      outputDate: this.outputDate,
      mailSendDate: this.mailSendDate,
      recipientMail: this.recipientMail,
    };
  }
}

export const BuyCryptoAmlReasonPendingStates = [
  AmlReason.DAILY_LIMIT,
  AmlReason.ANNUAL_LIMIT,
  AmlReason.ANNUAL_LIMIT_WITHOUT_KYC,
  AmlReason.OLKY_NO_KYC,
  AmlReason.NAME_CHECK_WITHOUT_KYC,
];
