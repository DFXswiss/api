import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';

@Entity()
export class AssetPrice extends IEntity {
  @ManyToOne(() => Asset, (a) => a.prices)
  asset: Asset;

  @Column({ type: 'float', nullable: false })
  priceEur: number;

  @Column({ type: 'float', nullable: false })
  priceUsd: number;

  @Column({ type: 'float', nullable: false })
  priceChf: number;
}
