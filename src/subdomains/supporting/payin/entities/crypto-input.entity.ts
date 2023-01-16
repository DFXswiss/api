import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { IEntity } from 'src/shared/models/entity';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { Column, Entity, ManyToOne } from 'typeorm';

export enum PayInPurpose {
  STAKING = 'Staking',
  SELL_CRYPTO = 'SellCrypto',
  BUY_CRYPTO = 'BuyCrypto',
}

export enum PayInStatus {
  CREATED = 'Created',
  ACKNOWLEDGED = 'Acknowledged',
  FAILED = 'Failed',
  TO_RETURN = 'ToReturn',
  RETURNED = 'Returned',
  FORWARDED = 'Forwarded',
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
  ): CryptoInput {
    const payIn = new CryptoInput();

    payIn.address = address;
    payIn.inTxId = txId;
    payIn.txType = txType;
    payIn.blockHeight = blockHeight;
    payIn.amount = amount;
    payIn.asset = asset;
    payIn.status = PayInStatus.CREATED;

    return payIn;
  }

  acknowledge(purpose: PayInPurpose): this {
    this.purpose = purpose;
    this.status = PayInStatus.ACKNOWLEDGED;
    this.isConfirmed = true;

    return this;
  }

  fail(purpose: PayInPurpose): this {
    this.purpose = purpose;
    this.status = PayInStatus.FAILED;

    return this;
  }

  designateReturn(purpose: PayInPurpose): this {
    this.purpose = purpose;
    this.status = PayInStatus.TO_RETURN;

    return this;
  }

  return(returnTxId: string): this {
    this.returnTxId = returnTxId;
    this.status = PayInStatus.RETURNED;

    return this;
  }
}
