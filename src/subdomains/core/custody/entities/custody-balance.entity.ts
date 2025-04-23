import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

@Entity()
@Index((custodyBalance: CustodyBalance) => [custodyBalance.user, custodyBalance.asset], { unique: true })
export class CustodyBalance extends IEntity {
  @Column({ type: 'float', default: 0 })
  balance: number;

  @ManyToOne(() => User, (user) => user.custodyBalances, { nullable: false, eager: true })
  user: User;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  asset: Asset;
}
