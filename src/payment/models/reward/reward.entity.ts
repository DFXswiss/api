import { IEntity } from 'src/shared/models/entity';
import { Column } from 'typeorm';

export enum RewardType {
  STAKING = 'StakingReward',
  REF = 'RefReward',
  //LM = 'LMReward',
}

export class Reward extends IEntity {
  @Column()
  @Column({ type: 'float', nullable: true })
  inputAmount: number;

  @Column({ length: 256, nullable: true }) // string oder referenzieren
  inputAsset: string;

  @Column({ type: 'float', nullable: true })
  inputReferenceAmount: number;

  @Column({ length: 256, nullable: true }) // string oder referenzieren
  inputReferenceAsset: string;

  @Column({ type: 'float', nullable: true })
  outputReferenceAmount: number;

  @Column({ length: 256, nullable: true }) // string oder referenzieren
  outputReferenceAsset: string;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @Column({ length: 256, nullable: true }) // string oder referenzieren
  outputAsset: string;

  @Column({ length: 256, nullable: false })
  txId: string;

  @Column({ type: 'datetime2', nullable: false })
  outputDate: Date;

  @Column({ type: 'float', nullable: true })
  amountInChf: number;

  @Column({ type: 'float', nullable: true })
  amountInEur: number;

  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @Column({ type: 'float', nullable: true })
  mailSendDate: number;
}
