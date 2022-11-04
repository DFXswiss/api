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
import { Price } from 'src/integration/exchange/dto/price.dto';
import { CryptoInput } from 'src/mix/models/crypto-input/crypto-input.entity';
import { CryptoRoute } from 'src/mix/models/crypto-route/crypto-route.entity';
import { BankTx } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.entity';
import { Buy } from '../../route/buy.entity';

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

  @Column({ length: 256, nullable: true })
  amlReason: AmlReason;

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

  @OneToOne(() => BuyCryptoFee, (fee) => fee.buyCrypto, { eager: true, cascade: true })
  fee: BuyCryptoFee;

  defineAssetExchangePair(): { outputReferenceAssetName: string; type: AssetType } | null {
    this.outputAsset = this.target?.asset;

    if (this.outputAsset.dexName === this.inputReferenceAsset) {
      this.outputReferenceAsset = this.outputAsset;
      return null;
    }

    if (['USDC', 'USDT'].includes(this.outputAsset.dexName)) {
      if (['EUR', 'CHF', 'USD', 'USDC', 'USDT'].includes(this.inputReferenceAsset)) {
        this.outputReferenceAsset = this.outputAsset;

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
        if (this.outputAsset.dexName === 'DFI') {
          this.outputReferenceAsset = this.outputAsset;

          return null;
        }

        return { outputReferenceAssetName: 'ETH', type: AssetType.COIN };

      case Blockchain.BINANCE_SMART_CHAIN:
        if (['DFI', 'BUSD'].includes(this.outputAsset.dexName)) {
          this.outputReferenceAsset = this.outputAsset;

          return null;
        }

        return { outputReferenceAssetName: 'BNB', type: AssetType.COIN };

      default:
        return {
          outputReferenceAssetName: 'BTC',
          type: this.target.asset.blockchain === Blockchain.BITCOIN ? AssetType.COIN : AssetType.TOKEN,
        };
    }
  }

  setOutputReferenceAsset(outputReferenceAsset: Asset): this {
    this.outputReferenceAsset = outputReferenceAsset;

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

  calculateOutputAmount(batchReferenceAmount: number, batchOutputAmount: number): this {
    if (batchReferenceAmount === 0) {
      throw new Error('Cannot calculate outputAmount, provided batchReferenceAmount is 0');
    }

    this.outputAmount = Util.round((this.outputReferenceAmount / batchReferenceAmount) * batchOutputAmount, 8);

    return this;
  }

  complete(payoutTxId: string, payoutFee: number): this {
    this.txId = payoutTxId;
    this.outputDate = new Date();
    this.isComplete = true;
    this.fee.addActualPayoutFee(payoutFee, this);

    return this;
  }

  confirmSentMail(): UpdateResult<BuyCrypto> {
    this.recipientMail = this.user.userData.mail;
    this.mailSendDate = Date.now();

    return [this.id, { recipientMail: this.recipientMail, mailSendDate: this.mailSendDate }];
  }

  get translationKey(): string {
    if (this.amlCheck === AmlCheck.PASS) {
      return this.inputReferenceAsset === this.outputReferenceAsset.dexName
        ? 'mail.payment.deposit.buyCryptoCrypto'
        : 'mail.payment.deposit.buyCryptoFiat';
    } else if (this.amlCheck === AmlCheck.PENDING) {
      if (this.amlReason === AmlReason.DAILY_LIMIT) return 'mail.payment.pending.dailyLimit';
      if (this.amlReason === AmlReason.ANNUAL_LIMIT) return 'mail.payment.pending.annualLimit';
      if (this.amlReason === AmlReason.OLKY_NO_KYC) return 'mail.payment.pending.olkyNoKyc';
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
          trimmedReturnAddress: this.buy?.iban ? Util.trimIBAN(this.buy.iban) : null,
        }
      : {
          address: this.cryptoRoute.targetDeposit?.address ?? this.cryptoRoute.user.address,
          asset: this.cryptoRoute.asset,
          trimmedReturnAddress: this.cryptoRoute?.user?.address
            ? Util.trimBlockchainAddress(this.cryptoRoute.user.address)
            : null,
        };
  }
}
