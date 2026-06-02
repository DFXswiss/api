import { IEntity } from 'src/shared/models/entity';
import { Column, Index, ManyToOne } from 'typeorm';
import { Asset } from './asset/asset.entity';

export class Reward extends IEntity {
  @Column({ type: 'float', nullable: true })
  inputAmount?: number;

  @Column({ length: 256, nullable: true })
  inputAsset?: string;

  @Column({ type: 'float', nullable: true })
  inputReferenceAmount?: number;

  @Column({ length: 256, nullable: true })
  inputReferenceAsset?: string;

  @Column({ type: 'float', nullable: true })
  outputReferenceAmount?: number;

  @Column({ length: 256, nullable: true })
  outputReferenceAsset?: string;

  @Column({ type: 'float', nullable: true })
  outputAmount?: number;

  @Index()
  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputAsset?: Asset;

  @Column({ length: 256, nullable: true })
  txId?: string;

  @Column({ type: 'timestamp', nullable: true })
  outputDate?: Date;

  @Column({ type: 'float', nullable: true })
  amountInChf?: number;

  @Column({ type: 'float', nullable: true })
  amountInEur?: number;

  @Column({ length: 256, nullable: true })
  recipientMail?: string;

  @Column({ type: 'timestamp', nullable: true })
  mailSendDate?: Date;
}
