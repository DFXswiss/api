import { Asset } from 'src/shared/models/asset/asset.entity';
import { DepositRoute } from 'src/payment/models/route/deposit-route.entity';
import { Staking } from 'src/payment/models/staking/staking.entity';
import { Entity, Column, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { PayoutType } from '../staking-reward/staking-reward.entity';
import { CryptoInput } from '../crypto-input/crypto-input.entity';

@Entity()
export class CryptoStaking extends IEntity {
  @Column({ type: 'datetime2' })
  inputDate: Date;

  @Column({ type: 'datetime2' })
  outputDate: Date;

  @Column({ length: 256 })
  outTxId: string;

  @Column({ length: 256, nullable: false })
  payoutType: PayoutType;

  @OneToOne(() => CryptoInput, { nullable: false })
  @JoinColumn()
  cryptoInput: CryptoInput;

  @Column({ type: 'float', nullable: true })
  usdtAmount?: number;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  asset: Asset;

  @ManyToOne(() => DepositRoute, { nullable: false })
  stakingRoute: Staking;
}
