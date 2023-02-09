import { DepositRoute } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { IEntity } from 'src/shared/models/entity';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CryptoInputInitSpecification } from '../specifications/crypto-input-init.specification';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export enum PayInPurpose {
  STAKING = 'Staking',
  SELL_CRYPTO = 'SellCrypto',
  BUY_CRYPTO = 'BuyCrypto',
}

export enum PayInSendType {
  FORWARD = 'Forward',
  RETURN = 'Return',
}

export enum PayInStatus {
  CREATED = 'Created',
  FAILED = 'Failed',
  IGNORED = 'Ignored',
  TO_RETURN = 'ToReturn',
  RETURNED = 'Returned',
  ACKNOWLEDGED = 'Acknowledged',
  FORWARDED = 'Forwarded',
  PREPARING = 'Preparing',
  PREPARED = 'Prepared',
  WAITING_FOR_PRICE_REFERENCE = 'WaitingForPriceReference',
}

@Entity()
@Index((input: CryptoInput) => [input.inTxId, input.asset, input.route, input.txSequence], {
  unique: true,
})
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

  @Column({ nullable: true })
  prepareTxId: string;

  @Column({ length: 256, nullable: true })
  txType: string;

  @Column({ nullable: true })
  sendType: string;

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
    if (estimatedFeeInPayInAsset == null) throw new Error('No fee estimation provided');
    if (totalAmount === 0) throw new Error('Total forward amount cannot be zero');
    if (estimatedFeeInPayInAsset / totalAmount > 0.005) throw new Error('Forward fee is too hight');
  }

  //*** PUBLIC API ***//

  acknowledge(purpose: PayInPurpose, route: DepositRoute, amlCheck: AmlCheck): this {
    this.purpose = purpose;
    this.route = route;
    this.amlCheck = amlCheck;
    this.status = PayInStatus.ACKNOWLEDGED;
    this.sendType = PayInSendType.FORWARD;

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
    this.sendType = PayInSendType.RETURN;
    this.destinationAddress = returnAddress;

    return this;
  }

  preparing(prepareTxId: string | null, forwardFeeAmount: number): this {
    this.prepareTxId = prepareTxId;
    this.forwardFeeAmount = forwardFeeAmount;
    this.status = PayInStatus.PREPARING;

    return this;
  }

  designateForward(forwardAddress: BlockchainAddress): this {
    this.destinationAddress = forwardAddress;

    return this;
  }

  forward(outTxId: string, forwardFeeAmount?: number): this {
    this.outTxId = outTxId;

    if (forwardFeeAmount != null) {
      this.forwardFeeAmount = forwardFeeAmount;
    }

    this.status = PayInStatus.FORWARDED;

    return this;
  }

  confirm(): this {
    this.isConfirmed = true;

    return this;
  }

  designateReturn(): this {
    /** do nothing */

    return this;
  }

  return(returnTxId: string): this {
    this.returnTxId = returnTxId;
    this.status = PayInStatus.RETURNED;

    return this;
  }

  addReferenceAmounts(btcAmount: number, usdtAmount: number): this {
    if (btcAmount == null || (usdtAmount == null && this.address.blockchain !== Blockchain.BITCOIN)) {
      this.status = PayInStatus.WAITING_FOR_PRICE_REFERENCE;
      return this;
    }

    this.btcAmount = btcAmount;
    this.usdtAmount = usdtAmount;

    /**
     * @note
     * setting status to Created when reference amounts are added
     * done here in addition to factory method for a retry getting reference amounts case and changing WAITING_FOR_PRICE_REFERENCE status
     */
    this.status = PayInStatus.CREATED;

    return this;
  }
}
