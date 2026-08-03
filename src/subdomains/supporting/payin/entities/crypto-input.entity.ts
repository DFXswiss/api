import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { baseUnitsTransformer } from 'src/shared/models/base-units.transformer';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { DepositRoute } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
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

export enum PayInConfirmationType {
  INPUT = 'Input',
  OUTPUT = 'Output',
  RETURN = 'Return',
}

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
  SENDING = 'Sending',
  SEND_UNCERTAIN = 'SendUncertain',
  COMPLETED = 'Completed',
}

export enum PayInType {
  PERMIT_TRANSFER = 'PermitTransfer',
  SIGNED_TRANSFER = 'SignedTransfer',
  CONFIRMED_DEPOSIT = 'ConfirmedDeposit',
  DEPOSIT = 'Deposit',
  PAYMENT = 'Payment',
}

@Entity()
@Index((i: CryptoInput) => [i.inTxId, i.asset, i.address.address, i.address.blockchain], { unique: true })
// Keyset index for the per-minute ledger content-change scan (ORDER BY updated, id).
@Index((i: CryptoInput) => [i.updated, i.id])
export class CryptoInput extends IEntity {
  @Column({ nullable: true })
  status?: PayInStatus;

  @Column({ length: 256 })
  inTxId: string;

  @Column({ type: 'integer', nullable: true })
  txSequence?: number;

  @Column({ length: 256, nullable: true })
  outTxId?: string;

  @Column({ length: 256, nullable: true })
  returnTxId?: string;

  @Column({ length: 256, nullable: true })
  recipientMail?: string;

  @Column({ type: 'timestamp', nullable: true })
  mailReturnSendDate?: Date;

  @Column({ nullable: true })
  prepareTxId?: string;

  @Column({ length: 256, nullable: true })
  txType?: PayInType;

  @Column({ nullable: true })
  action?: PayInAction;

  @Column(() => BlockchainAddress)
  address: BlockchainAddress;

  @Column(() => BlockchainAddress)
  destinationAddress: BlockchainAddress;

  @Column({ nullable: true, type: 'integer' })
  blockHeight?: number;

  @Column({ type: 'float' })
  amount: number;

  // §2.3 native-first exactness (issue #4287 stage 1): the EXACT integer base units (wei/satoshi) of `amount`,
  // captured from the on-chain raw value at ingestion BEFORE the float collapse in `amount`. Nullable + additive —
  // legacy rows and chains without a raw integer stay null and the ledger falls back to the ≤8-dp float derivation
  // (fail-open). numeric ↔ JS bigint via baseUnitsTransformer.
  @Column({ type: 'numeric', nullable: true, transformer: baseUnitsTransformer })
  amountBaseUnits?: bigint | null;

  @Column({ nullable: true, type: 'float' })
  chargebackAmount?: number;

  @Column({ type: 'float', nullable: true })
  forwardFeeAmount?: number;

  @Column({ type: 'float', nullable: true })
  forwardFeeAmountChf?: number;

  // §2.3 native-first exactness (issue #4287): the EXACT integer base units (wei) of the on-chain deposit-FORWARD gas
  // fee — the actual gasUsed*effectiveGasPrice of the forward tx, captured at OUTPUT confirmation. Nullable + additive:
  // set ONLY for an EVM COIN forward (the native gas coin IS the forwarded/booked asset, 18-dp wei); token forwards,
  // non-EVM chains, legacy rows and any capture error stay null and the ledger derives the seq1 fee leg from the
  // estimate float (fail-open). numeric <-> JS bigint via baseUnitsTransformer.
  @Column({ type: 'numeric', nullable: true, transformer: baseUnitsTransformer })
  forwardFeeAmountBaseUnits?: bigint | null;

  @Index()
  @ManyToOne(() => Asset, { nullable: true, eager: true })
  asset?: Asset;

  @Column({ default: false })
  isConfirmed: boolean;

  @Column({ length: 256, nullable: true })
  purpose?: PayInPurpose;

  @Index()
  @ManyToOne(() => DepositRoute, { eager: true, nullable: true })
  route?: DepositRoute;

  @OneToOne(() => Transaction, { nullable: true })
  @JoinColumn()
  transaction?: Transaction;

  @OneToOne(() => BuyFiat, (buyFiat) => buyFiat.cryptoInput, { nullable: true })
  buyFiat?: BuyFiat;

  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.cryptoInput, { nullable: true })
  buyCrypto?: BuyCrypto;

  @Index()
  @ManyToOne(() => PaymentLinkPayment, (payment) => payment.cryptoInputs, { nullable: true })
  paymentLinkPayment?: PaymentLinkPayment;

  @Index()
  @ManyToOne(() => PaymentQuote, (quote) => quote.cryptoInputs, { nullable: true })
  paymentQuote?: PaymentQuote;

  @Column({ type: 'text', nullable: true })
  senderAddresses?: string;

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
    amountBaseUnits?: bigint | null,
  ): CryptoInput {
    const payIn = new CryptoInput();

    payIn.senderAddresses = senderAddresses;
    payIn.address = receiverAddress;
    payIn.inTxId = txId;
    payIn.txType = txType;
    payIn.txSequence = txSequence;
    payIn.blockHeight = blockHeight;
    payIn.amount = amount;
    payIn.amountBaseUnits = amountBaseUnits ?? null;
    payIn.asset = asset;

    payIn.status = PayInStatus.CREATED;

    if (!payIn.asset || !payIn.amount) payIn.status = PayInStatus.FAILED;

    return payIn;
  }

  //*** UTILITY METHODS ***//

  static verifyForwardFee(estimatedFee: number, maxFee: number, feeCap: number, totalAmount: number): void {
    if (estimatedFee == null) throw new Error('No fee estimation provided');
    if (maxFee == null) throw new Error('No maximum fee provided');
    if (totalAmount === 0) throw new Error('Total forward amount cannot be zero');

    const maxApplicableFee = maxFee ? maxFee : feeCap;

    if (estimatedFee > maxApplicableFee * 1.01) {
      throw new FeeLimitExceededException(
        `Forward fee is too high (estimated ${estimatedFee}, max. ${maxApplicableFee})`,
      );
    }
  }

  //*** PUBLIC API ***//

  acknowledge(purpose: PayInPurpose, route: DepositRoute, isForwardRequired: boolean): this {
    if (!route) throw new Error('Missing route');

    this.purpose = purpose;
    this.route = route;
    this.status = this.isPayment || !isForwardRequired ? PayInStatus.COMPLETED : PayInStatus.ACKNOWLEDGED;

    return this;
  }

  ignore(purpose: PayInPurpose, route: DepositRoute): this {
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

  resetPreparation(): this {
    this.prepareTxId = null;
    this.forwardFeeAmount = null;
    this.forwardFeeAmountChf = null;
    this.status = PayInStatus.ACKNOWLEDGED;

    return this;
  }

  designateForward(forwardAddress: BlockchainAddress): this {
    this.destinationAddress = forwardAddress;

    return this;
  }

  designateSending(): this {
    this.status = PayInStatus.SENDING;

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

  resetForward(): this {
    this.status = PayInStatus.ACKNOWLEDGED;
    this.outTxId = null;
    this.prepareTxId = null;
    this.forwardFeeAmount = null;
    this.forwardFeeAmountChf = null;

    return this;
  }

  // Recover an operator-verified not-broadcast SendUncertain pay-in: return it to its direction's
  // initial send status so the send cron re-selects it and re-runs the full designate-before-broadcast
  // flow. Staged chains rebuild a fresh preparation, overwriting any prior preparation artifacts.
  resetSend(): UpdateResult<CryptoInput> {
    if (![PayInAction.FORWARD, PayInAction.RETURN].includes(this.action))
      throw new Error(`Cannot reset send for pay-in ${this.id} with action ${this.action}`);

    const update: Partial<CryptoInput> = {
      status: this.action === PayInAction.RETURN ? PayInStatus.TO_RETURN : PayInStatus.ACKNOWLEDGED,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  confirm(direction: PayInConfirmationType, forwardRequired: boolean): UpdateResult<CryptoInput> {
    let update: Partial<CryptoInput> = {};

    switch (direction) {
      case PayInConfirmationType.INPUT:
        if (!this.purpose) break;
        update = { isConfirmed: true, status: !forwardRequired ? PayInStatus.COMPLETED : undefined };
        break;

      case PayInConfirmationType.OUTPUT:
        update = { status: PayInStatus.FORWARD_CONFIRMED };
        break;

      case PayInConfirmationType.RETURN:
        update = { status: PayInStatus.RETURN_CONFIRMED };
        break;
    }

    Object.assign(this, update);

    return [this.id, update];
  }

  fail(): UpdateResult<CryptoInput> {
    const update: Partial<CryptoInput> = { status: PayInStatus.FAILED };

    Object.assign(this, update);

    return [this.id, update];
  }

  confirmationTxId(direction: PayInConfirmationType): string {
    return direction === PayInConfirmationType.INPUT
      ? this.inTxId
      : direction === PayInConfirmationType.OUTPUT
        ? this.outTxId
        : this.returnTxId;
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
      recipientMail: this.transaction.userData.mail,
      mailReturnSendDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get sendingAmount(): number {
    return this.action === PayInAction.RETURN ? this.chargebackAmount : this.amount;
  }

  get maxForwardFee(): number {
    return this.buyCrypto?.blockchainFee ?? this.buyFiat?.blockchainFee;
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

  get isSettled(): boolean {
    return CryptoInputSettledStatus.includes(this.status);
  }

  get userData(): UserData {
    return this.transaction.userData;
  }
}

export const CryptoInputSettledStatus = [PayInStatus.FORWARD_CONFIRMED, PayInStatus.COMPLETED];

// Send in flight or unresolved — a return must not re-arm it.
export const CryptoInputInFlightSendStatus = [PayInStatus.SENDING, PayInStatus.SEND_UNCERTAIN];
