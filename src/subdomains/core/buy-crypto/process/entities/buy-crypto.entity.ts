import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankTx } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { Buy } from '../../routes/buy/buy.entity';
import { AmlCheck } from '../enums/aml-check.enum';
import { AmlReason } from '../enums/aml-reason.enum';
import { BuyCryptoBatch } from './buy-crypto-batch.entity';
import { BuyCryptoFee } from './buy-crypto-fees.entity';

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

  @Column({ length: 256, nullable: true })
  chargebackCryptoTxId: string;

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

    switch (this.target.asset.blockchain) {
      case Blockchain.DEFICHAIN:
        if (this.isUsd) {
          this.setOutputReferenceAsset(this.outputAsset);

          return null;
        }

        return {
          outputReferenceAssetName: 'BTC',
          type: AssetType.TOKEN,
        };

      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
        if (this.isUsd) {
          return {
            outputReferenceAssetName: 'USDT',
            type: AssetType.TOKEN,
          };
        }

        return {
          outputReferenceAssetName: 'ETH',
          type: AssetType.COIN,
        };

      case Blockchain.ETHEREUM:
      case Blockchain.BINANCE_SMART_CHAIN:
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

  private get isUsd(): boolean {
    return (
      ['USDC', 'USDT', 'BUSD'].includes(this.outputAsset.dexName) &&
      ['EUR', 'CHF', 'USD', 'USDC', 'USDT'].includes(this.inputReferenceAsset)
    );
  }

  setOutputReferenceAsset(asset: Asset): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      outputReferenceAsset: asset,
      status: BuyCryptoStatus.PREPARED,
    };

    Object.assign(this, update);

    return [this.id, update];
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

      this.outputReferenceAmount = price.convert(this.inputReferenceAmountMinusFee, 8);
    }

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

  setPriceMismatchStatus(): UpdateResult<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      status: BuyCryptoStatus.PRICE_MISMATCH,
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
      recipientMail: this.user.userData.mail,
      mailSendDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get transactionId(): string {
    if (this.target.asset.blockchain === Blockchain.LIGHTNING) return Util.blankStart(this.txId);
    return txExplorerUrl(this.target.asset.blockchain, this.txId);
  }

  get translationKey(): string {
    if (this.amlCheck === AmlCheck.PASS) {
      if (this.target.asset.blockchain === Blockchain.LIGHTNING)
        return this.cryptoRoute
          ? 'mail.payment.deposit.buyCryptoCryptoLightning'
          : 'mail.payment.deposit.buyCryptoFiatLightning';

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
      return this.cryptoRoute
        ? 'mail.payment.withdrawal.paybackToAddressInitiated'
        : 'mail.payment.deposit.paybackInitiated';
    }

    throw new Error(`Tried to send a mail for buy-crypto ${this.id} in invalid state`);
  }

  get user(): User {
    return this.buy ? this.buy.user : this.cryptoRoute.user;
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

  //*** HELPER METHODS ***//

  private resetTransaction(): Partial<BuyCrypto> {
    const update: Partial<BuyCrypto> = {
      outputReferenceAmount: null,
      batch: null,
      isComplete: false,
      outputAmount: null,
      outputDate: null,
      mailSendDate: null,
      recipientMail: null,
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
];
