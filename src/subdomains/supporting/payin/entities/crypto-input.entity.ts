import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { DepositRoute, DepositRouteType } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { Transaction } from '../../payment/entities/transaction.entity';

export enum PayInPurpose {
  STAKING = 'Staking',
  BUY_FIAT = 'BuyFiat',
  BUY_CRYPTO = 'BuyCrypto',
}

export enum PayInAction {
  FORWARD = 'Forward',
  WAITING = 'Waiting',
  RETURN = 'Return',
}

export type PayInConfirmationType = 'Input' | 'Output' | 'Return';

export enum PayInStatus {
  CREATED = 'Created',
  FAILED = 'Failed',
  IGNORED = 'Ignored',
  TO_RETURN = 'ToReturn',
  RETURNED = 'Returned',
  RETURN_CONFIRMED = 'ReturnConfirmed',
  ACKNOWLEDGED = 'Acknowledged',
  FORWARDED = 'Forwarded',
  FORWARD_CONFIRMED = 'ForwardConfirmed',
  PREPARING = 'Preparing',
  PREPARED = 'Prepared',
  COMPLETED = 'Completed',
}

export enum PayInType {
  PERMIT_TRANSFER = 'PermitTransfer',
  DEPOSIT = 'Deposit',
  PAYMENT = 'Payment',
}

@Entity()
@Index((i: CryptoInput) => [i.inTxId, i.asset, i.address.address, i.address.blockchain], { unique: true })
export class CryptoInput extends IEntity {
  @Column({ nullable: true })
  status: PayInStatus;

  @Column({ length: 256 })
  inTxId: string;

  @Column({ type: 'integer', nullable: true })
  txSequence: number;

  @Column({ length: 256, nullable: true })
  outTxId: string;

  @Column({ length: 256, nullable: true })
  returnTxId: string;

  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @Column({ type: 'datetime2', nullable: true })
  mailReturnSendDate: Date;

  @Column({ nullable: true })
  prepareTxId: string;

  @Column({ length: 256, nullable: true })
  txType: PayInType;

  @Column({ nullable: true })
  action: PayInAction;

  @Column(() => BlockchainAddress)
  address: BlockchainAddress;

  @Column(() => BlockchainAddress)
  destinationAddress: BlockchainAddress;

  @Column({ nullable: true, type: 'integer' })
  blockHeight: number;

  @Column({ nullable: false, type: 'float' })
  amount: number;

  @Column({ nullable: true, type: 'float' })
  chargebackAmount: number;

  @Column({ type: 'float', nullable: true })
  forwardFeeAmount: number;

  @Column({ type: 'float', nullable: true })
  forwardFeeAmountChf: number;

  @ManyToOne(() => Asset, { nullable: true, eager: true })
  asset: Asset;

  @Column({ default: false })
  isConfirmed: boolean;

  @Column({ length: 256, nullable: true })
  purpose: PayInPurpose;

  @ManyToOne(() => DepositRoute, { eager: true, nullable: true })
  route: DepositRouteType;

  @OneToOne(() => Transaction, { nullable: true })
  @JoinColumn()
  transaction: Transaction;

  @OneToOne(() => BuyFiat, (buyFiat) => buyFiat.cryptoInput, { nullable: true })
  buyFiat: BuyFiat;

  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.cryptoInput, { nullable: true })
  buyCrypto: BuyCrypto;

  @ManyToOne(() => PaymentLinkPayment, (payment) => payment.cryptoInputs, { nullable: true })
  paymentLinkPayment: PaymentLinkPayment;

  @ManyToOne(() => PaymentQuote, (quote) => quote.cryptoInputs, { nullable: true })
  paymentQuote: PaymentQuote;

  @Column({ length: 'MAX', nullable: true })
  senderAddresses: string;

  //*** FACTORY METHODS ***//

  static create(
    senderAddresses: string,
    receiverAddress: BlockchainAddress,
    txId: string,
    txType: PayInType,
    txSequence: number | null,
    blockHeight: number,
    amount: number,
    asset: Asset,
  ): CryptoInput {
    const payIn = new CryptoInput();

    payIn.senderAddresses = senderAddresses;
    payIn.address = receiverAddress;
    payIn.inTxId = txId;
    payIn.txType = txType;
    payIn.txSequence = txSequence;
    payIn.blockHeight = blockHeight;
    payIn.amount = amount;
    payIn.asset = asset;

    payIn.status = PayInStatus.CREATED;

    if (!payIn.asset || !payIn.amount) payIn.status = PayInStatus.FAILED;

    return payIn;
  }

  //*** UTILITY METHODS ***//

  static verifyEstimatedFee(estimatedFee: number, minInputFee: number, totalAmount: number): void {
    if (estimatedFee == null) throw new Error('No fee estimation provided');
    if (totalAmount === 0) throw new Error('Total forward amount cannot be zero');

    const maxFee = Math.max(totalAmount * Config.payIn.forwardFeeLimit, minInputFee);

    if (estimatedFee > maxFee) {
      const feePercent = Util.toPercent(estimatedFee / totalAmount);
      throw new FeeLimitExceededException(`Forward fee is too high (${estimatedFee}, ${feePercent})`);
    }
  }

  //*** PUBLIC API ***//

  acknowledge(purpose: PayInPurpose, route: DepositRouteType, isForwardRequired: boolean): this {
    this.purpose = purpose;
    this.route = route;
    this.status = this.isPayment || !isForwardRequired ? PayInStatus.COMPLETED : PayInStatus.ACKNOWLEDGED;

    return this;
  }

  fail(purpose: PayInPurpose): this {
    this.purpose = purpose;
    this.status = PayInStatus.FAILED;

    return this;
  }

  ignore(purpose: PayInPurpose, route: DepositRouteType): this {
    this.purpose = purpose;
    this.route = route;
    this.status = PayInStatus.IGNORED;

    return this;
  }

  triggerReturn(returnAddress: BlockchainAddress, chargebackAmount: number): this {
    this.status = PayInStatus.TO_RETURN;
    this.action = PayInAction.RETURN;
    this.destinationAddress = returnAddress;
    this.chargebackAmount = chargebackAmount;

    return this;
  }

  preparing(prepareTxId: string | null, forwardFeeAmount: number, feeAmountChf: number): this {
    this.prepareTxId = prepareTxId;
    this.forwardFeeAmount = forwardFeeAmount;
    this.forwardFeeAmountChf = feeAmountChf;
    this.status = PayInStatus.PREPARING;

    return this;
  }

  designateForward(forwardAddress: BlockchainAddress): this {
    this.destinationAddress = forwardAddress;

    return this;
  }

  forward(outTxId: string, forwardFeeAmount?: number, feeAmountChf?: number): this {
    this.outTxId = outTxId;

    if (forwardFeeAmount != null) {
      this.forwardFeeAmount = forwardFeeAmount;
      this.forwardFeeAmountChf = feeAmountChf;
    }

    this.status = PayInStatus.FORWARDED;

    return this;
  }

  confirm(direction: PayInConfirmationType, forwardRequired: boolean): this {
    switch (direction) {
      case 'Input':
        if (!this.purpose) break;
        this.isConfirmed = true;
        this.status = !forwardRequired ? PayInStatus.COMPLETED : undefined;
        break;

      case 'Output':
        this.status = PayInStatus.FORWARD_CONFIRMED;
        break;

      case 'Return':
        this.status = PayInStatus.RETURN_CONFIRMED;
        break;
    }

    return this;
  }

  confirmationTxId(direction: PayInConfirmationType): string {
    return direction === 'Input' ? this.inTxId : direction === 'Output' ? this.outTxId : this.returnTxId;
  }

  designateReturn(): this {
    /** do nothing */

    return this;
  }

  return(returnTxId: string, returnFeeAmount?: number): this {
    this.returnTxId = returnTxId;
    this.status = PayInStatus.RETURNED;

    if (returnFeeAmount != null) {
      this.forwardFeeAmount = returnFeeAmount;
    }

    return this;
  }

  returnMail(): UpdateResult<CryptoInput> {
    const update: Partial<CryptoInput> = {
      recipientMail: this.route.user.userData.mail,
      mailReturnSendDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get sendingAmount(): number {
    return this.action === PayInAction.RETURN ? this.chargebackAmount : this.amount;
  }

  get isLightningInput(): boolean {
    return this.asset.blockchain === Blockchain.LIGHTNING;
  }

  get amlReason(): AmlReason {
    return this.route instanceof Staking ? AmlReason.STAKING_DISCONTINUED : AmlReason.ASSET_CURRENTLY_NOT_AVAILABLE;
  }

  get isPayment(): boolean {
    return this.txType === PayInType.PAYMENT;
  }

  get feeAmountChf(): number {
    return this.forwardFeeAmountChf;
  }
}
