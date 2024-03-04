import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';

@Entity()
export class BlockchainFee extends IEntity {
  @OneToOne(() => Asset, { nullable: false, eager: true })
  @JoinColumn()
  asset: Asset;

  @Column({ type: 'float', nullable: true })
  amount: number; //CHF
}
