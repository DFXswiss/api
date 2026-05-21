import { IEntity } from 'src/shared/models/entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { Deposit } from '../../../supporting/address-pool/deposit/deposit.entity';
import { DepositRoute } from '../../../supporting/address-pool/route/deposit-route.entity';
import { PayoutType } from './staking-reward.entity';
import { Staking } from './staking.entity';

@Entity()
export class CryptoStaking extends IEntity {
  @Column({ type: 'timestamp' })
  inputDate: Date;

  @Column({ length: 256 })
  inTxId: string;

  @Column({ type: 'float' })
  inputAmountInChf: number;

  @Column({ type: 'float' })
  inputAmountInEur: number;

  @Column({ type: 'float' })
  inputAmount: number;

  @Column()
  inputAsset: string;

  @Column({ type: 'timestamp', nullable: true })
  inputMailSendDate?: Date;

  @Column({ type: 'float', nullable: true })
  outputAmountInChf?: number;

  @Column({ type: 'float', nullable: true })
  outputAmountInEur?: number;

  @Column({ type: 'float', nullable: true })
  outputAmount?: number;

  @Column({ nullable: true })
  outputAsset?: string;

  @Column({ type: 'timestamp', nullable: true })
  outputMailSendDate?: Date;

  @Column({ type: 'timestamp', nullable: false })
  outputDate: Date;

  @Column({ length: 256, nullable: true })
  outTxId?: string;

  @Column({ length: 256, nullable: true })
  outTxId2?: string;

  @Column({ length: 256, nullable: false })
  payoutType: PayoutType;

  @ManyToOne(() => Deposit, { eager: true, nullable: true })
  paybackDeposit?: Deposit;

  @OneToOne(() => CryptoInput, { nullable: false })
  @JoinColumn()
  cryptoInput: CryptoInput;

  @ManyToOne(() => DepositRoute, { nullable: false })
  stakingRoute: Staking;

  @Column({ default: false })
  isReinvest: boolean;

  @Column({ default: false })
  readyToPayout: boolean;
}
