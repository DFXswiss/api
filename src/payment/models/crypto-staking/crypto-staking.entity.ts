import { DepositRoute } from 'src/payment/models/route/deposit-route.entity';
import { Staking } from 'src/payment/models/staking/staking.entity';
import { Entity, Column, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { PayoutType } from '../staking-reward/staking-reward.entity';
import { CryptoInput } from '../crypto-input/crypto-input.entity';

@Entity()
export class CryptoStaking extends IEntity {
  @Column({ type: 'datetime2', nullable: false })
  inputDate: Date;

  @Column({ length: 256, nullable: false })
  inTxId: string;

  @Column({ type: 'float', nullable: false })
  inputAmountInChf: number;

  @Column({ type: 'float', nullable: false })
  inputAmountInEur: number;

  @Column({ type: 'float', nullable: false })
  inputAmount: number;

  @Column({ nullable: false })
  inputAsset: string;

  @Column({ type: 'float', nullable: true })
  inputMailSendDate: number;

  @Column({ type: 'float', nullable: true })
  outputAmountInChf: number;

  @Column({ type: 'float', nullable: true })
  outputAmountInEur: number;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @Column({ nullable: true })
  outputAsset: string;

  @Column({ type: 'float', nullable: true })
  outputMailSendDate: number;

  @Column({ type: 'datetime2', nullable: false })
  outputDate: Date;

  @Column({ length: 256, nullable: true })
  outTxId: string;

  @Column({ length: 256, nullable: false })
  payoutType: PayoutType;

  @OneToOne(() => CryptoInput, { nullable: false })
  @JoinColumn()
  cryptoInput: CryptoInput;

  @ManyToOne(() => DepositRoute, { nullable: false })
  stakingRoute: Staking;

  @Column({ default: false })
  isReinvest: boolean;
}
