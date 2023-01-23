import { DepositRoute } from 'src/mix/models/route/deposit-route.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { IEntity } from 'src/shared/models/entity';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { Column, Entity, ManyToOne } from 'typeorm';
import { CryptoInputInitSpecification } from '../specifications/crypto-input-init.specification';

export enum PayInPurpose {
  STAKING = 'Staking',
  SELL_CRYPTO = 'SellCrypto',
  BUY_CRYPTO = 'BuyCrypto',
}

export enum PayInStatus {
  CREATED = 'Created',
  FAILED = 'Failed',
  IGNORED = 'Ignored',
  TO_RETURN = 'ToReturn',
  RETURNING = 'Returning',
  RETURNED = 'Returned',
  ACKNOWLEDGED = 'Acknowledged',
  PREPARING = 'Preparing',
  FORWARDING = 'Forwarding',
  FORWARDED = 'Forwarded',
  WAITING_FOR_PRICE_REFERENCE = 'WaitingForPriceReference',
}

@Entity()
export class CryptoInput extends IEntity {
  @Column({ nullable: false })
  status: PayInStatus;

  @Column({ nullable: true })
  inTxId: string;

  @Column({ type: 'integer', nullable: true })
  txSequence: number;

  @Column({ length: 256, nullable: true })
  outTxId: string;

  @Column({ nullable: true })
  returnTxId: string;

  @Column({ nullable: true })
  prepareTxId: string;

  @Column()
  txType: string;

  @Column(() => BlockchainAddress)
  address: BlockchainAddress;

  @Column(() => BlockchainAddress)
  destinationAddress: BlockchainAddress;

  @Column({ nullable: true, type: 'integer' })
  blockHeight: number;

  @Column({ nullable: false, type: 'float' })
  amount: number;

  @Column({ type: 'float', nullable: true })
  forwardFeeAmount: number;

  @ManyToOne(() => Asset, { nullable: true, eager: true })
  asset: Asset;

  @Column({ default: false })
  isConfirmed: boolean;

  @Column({ length: 256, default: AmlCheck.FAIL })
  amlCheck: AmlCheck;

  @Column({ nullable: true })
  purpose: PayInPurpose;

  @ManyToOne(() => DepositRoute, { eager: true, nullable: true })
  route: DepositRoute;

  @Column({ type: 'float', nullable: true })
  btcAmount?: number;

  @Column({ type: 'float', nullable: true })
  usdtAmount?: number;

  // TODO -> maybe add Ignored status and comment

  //*** FACTORY METHODS ***//

  static create(
    address: BlockchainAddress,
    txId: string,
    txType: string,
    blockHeight: number,
    amount: number,
    asset: Asset,
    btcAmount: number,
    usdtAmount: number,
  ): CryptoInput {
    const payIn = new CryptoInput();

    payIn.address = address;
    payIn.inTxId = txId;
    payIn.txType = txType;
    payIn.blockHeight = blockHeight;
    payIn.amount = amount;
    payIn.asset = asset;

    payIn.status = PayInStatus.CREATED;

    payIn.addReferenceAmounts(btcAmount, usdtAmount);

    CryptoInputInitSpecification.isSatisfiedBy(payIn);

    return payIn;
  }

  //*** UTILITY METHODS ***//

  static verifyEstimatedFee(estimatedFeeInPayInAsset: number, totalAmount: number): void {
    if (totalAmount === 0) throw new Error('Total forward amount cannot be zero');
    if (estimatedFeeInPayInAsset / totalAmount > 0.005) throw new Error('Forward fee is too hight');
  }

  //*** PUBLIC API ***//

  acknowledge(purpose: PayInPurpose, route: DepositRoute, amlCheck: AmlCheck): this {
    this.purpose = purpose;
    this.route = route;
    this.amlCheck = amlCheck;
    this.status = PayInStatus.ACKNOWLEDGED;

    return this;
  }

  fail(purpose: PayInPurpose): this {
    this.purpose = purpose;
    this.status = PayInStatus.FAILED;

    return this;
  }

  ignore(purpose: PayInPurpose, route: DepositRoute): this {
    this.purpose = purpose;
    this.route = route;
    this.status = PayInStatus.IGNORED;

    return this;
  }

  triggerReturn(purpose: PayInPurpose, returnAddress: BlockchainAddress, route: DepositRoute): this {
    this.purpose = purpose;
    this.route = route;
    this.status = PayInStatus.TO_RETURN;
    this.destinationAddress = returnAddress;

    return this;
  }

  preparing(prepareTxId: string): this {
    this.prepareTxId = prepareTxId;
    this.status = PayInStatus.PREPARING;

    return this;
  }

  designateForward(forwardAddress: BlockchainAddress): this {
    this.status = PayInStatus.FORWARDING;
    this.destinationAddress = forwardAddress;

    return this;
  }

  forward(outTxId: string, forwardFeeAmount: number = null): this {
    this.outTxId = outTxId;
    this.forwardFeeAmount = forwardFeeAmount;

    return this;
  }

  designateReturn(): this {
    this.status = PayInStatus.RETURNING;

    return this;
  }

  return(returnTxId: string): this {
    this.returnTxId = returnTxId;
    this.status = PayInStatus.RETURNED;

    return this;
  }

  addReferenceAmounts(btcAmount: number, usdtAmount: number): this {
    if (btcAmount == null || usdtAmount == null) {
      this.status = PayInStatus.WAITING_FOR_PRICE_REFERENCE;
      return this;
    }

    this.btcAmount = btcAmount;
    this.usdtAmount = usdtAmount;

    return this;
  }
}
