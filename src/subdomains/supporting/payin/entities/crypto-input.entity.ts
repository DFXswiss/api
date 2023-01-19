import { Price } from 'src/integration/exchange/dto/price.dto';
import { Deposit } from 'src/mix/models/deposit/deposit.entity';
import { DepositRoute } from 'src/mix/models/route/deposit-route.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { Column, Entity, ManyToOne } from 'typeorm';

export enum PayInPurpose {
  STAKING = 'Staking',
  SELL_CRYPTO = 'SellCrypto',
  BUY_CRYPTO = 'BuyCrypto',
}

export enum PayInStatus {
  CREATED = 'Created',
  FAILED = 'Failed',
  TO_RETURN = 'ToReturn',
  RETURNING = 'Returning',
  RETURNED = 'Returned',
  ACKNOWLEDGED = 'Acknowledged',
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
    referencePrices: Price[],
  ): CryptoInput {
    const payIn = new CryptoInput();

    payIn.address = address;
    payIn.inTxId = txId;
    payIn.txType = txType;
    payIn.blockHeight = blockHeight;
    payIn.amount = amount;
    payIn.asset = asset;
    payIn.status = PayInStatus.CREATED;

    payIn.addReferenceAmounts(referencePrices);

    return payIn;
  }

  //*** UTILITY METHODS ***//

  static verifyEstimatedFee(estimatedFeeInPayInAsset: number, totalAmount: number): void {
    if (totalAmount === 0) throw new Error('Total forward amount cannot be zero');
    if (estimatedFeeInPayInAsset / totalAmount > 0.005) throw new Error('Forward fee is too hight');
  }

  //*** PUBLIC API ***//

  acknowledge(purpose: PayInPurpose, route: DepositRoute): this {
    this.purpose = purpose;
    this.route = route;
    this.status = PayInStatus.ACKNOWLEDGED;

    return this;
  }

  fail(purpose: PayInPurpose): this {
    this.purpose = purpose;
    this.status = PayInStatus.FAILED;

    return this;
  }

  triggerReturn(purpose: PayInPurpose, returnAddress: BlockchainAddress, route: DepositRoute): this {
    this.purpose = purpose;
    this.route = route;
    this.status = PayInStatus.TO_RETURN;
    this.destinationAddress = returnAddress;

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

  addReferenceAmounts(referencePrices: Price[]): this {
    try {
      this.btcAmount = this.getReferenceAmountOrThrow(referencePrices, 'BTC');
      this.usdtAmount = this.getReferenceAmountOrThrow(referencePrices, 'USDT');
    } catch (e) {
      this.status = PayInStatus.WAITING_FOR_PRICE_REFERENCE;
    }

    return this;
  }

  //*** HELPER METHODS ***//

  private getReferenceAmountOrThrow(referencePrices: Price[], assetName: string): number {
    const price = referencePrices.find((p) => p.source === this.asset.dexName && p.target === assetName);

    if (!price) {
      throw new Error(`Cannot calculate pay-in reference amount, ${this.asset.dexName}/${assetName} price is missing`);
    }

    if (!price.price) {
      throw new Error('Cannot calculate pay-in reference amount, price value is 0');
    }

    return Util.round(this.amount / price.price, 8);
  }
}
