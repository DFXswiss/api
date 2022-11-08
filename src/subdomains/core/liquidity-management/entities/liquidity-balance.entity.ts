import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Column } from 'typeorm';

export class LiquidityBalance extends IEntity {
  @Column({ length: 256, nullable: true })
  asset: Asset;

  @Column({ length: 256, nullable: true })
  fiat: Fiat;

  @Column({ type: 'float', nullable: true })
  amount: number;

  //*** GETTER ***//

  get target(): Asset | Fiat {
    return this.asset ?? this.fiat;
  }
}
