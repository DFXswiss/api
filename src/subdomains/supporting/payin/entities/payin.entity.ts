import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';

export enum PayInPurpose {
  STAKING = 'Staking',
  SELL_CRYPTO = 'SellCrypto',
}

export enum PayInStatus {
  CREATED = 'Created',
  ACKNOWLEDGED = 'Acknowledged',
  FAILED = 'Failed',
}

@Entity()
export class PayIn extends IEntity {
  @Column({ nullable: false })
  status: PayInStatus;

  @Column({ nullable: true })
  txId: string;

  @Column(() => BlockchainAddress)
  address: BlockchainAddress;

  @Column({ nullable: true })
  returnTxId: string;

  @Column({ nullable: true, type: 'integer' })
  blockHeight: number;

  @Column({ nullable: false, type: 'float' })
  amount: number;

  @ManyToOne(() => Asset, { nullable: true, eager: true })
  asset: Asset;

  @Column({ nullable: true })
  purpose: PayInPurpose;

  //*** FACTORY METHODS ***//

  static create(address: BlockchainAddress, txId: string, blockHeight: number, amount: number, asset: Asset): PayIn {
    const payIn = new PayIn();

    payIn.address = address;
    payIn.txId = txId;
    payIn.blockHeight = blockHeight;
    payIn.amount = amount;
    payIn.asset = asset;
    payIn.status = PayInStatus.CREATED;

    return payIn;
  }

  acknowledge(purpose: PayInPurpose): this {
    this.purpose = purpose;
    this.status = PayInStatus.ACKNOWLEDGED;

    return this;
  }

  fail(purpose: PayInPurpose): this {
    this.purpose = purpose;
    this.status = PayInStatus.FAILED;

    return this;
  }

  return(returnTxId: string): this {
    this.returnTxId = returnTxId;

    return this;
  }
}
