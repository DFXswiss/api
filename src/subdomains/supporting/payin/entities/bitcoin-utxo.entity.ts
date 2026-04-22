import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CryptoInput } from './crypto-input.entity';

export enum BitcoinUtxoStatus {
  UNCONFIRMED = 'Unconfirmed',
  CONFIRMED = 'Confirmed',
  SPENT = 'Spent',
  FAILED = 'Failed',
}

@Entity()
@Index(['txid', 'vout'], { unique: true })
export class BitcoinUtxo extends IEntity {
  @Column()
  txid: string;

  @Column()
  vout: number;

  @Column()
  address: string;

  @Column({ type: 'float' })
  amount: number;

  @Column({ length: 256 })
  status: BitcoinUtxoStatus;

  @Column({ nullable: true })
  label: string;

  @Column({ nullable: true, length: 'MAX' })
  senderAddresses: string;

  @Column({ nullable: true })
  blockHeight: number;

  @Column({ nullable: true })
  spentInTxId: string;

  @ManyToOne(() => CryptoInput, { nullable: true })
  payIn: CryptoInput;
}
