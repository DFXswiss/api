import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { FaucetStatus } from '../enums/faucet';

@Entity()
export class Faucet extends IEntity {
  @Column({ nullable: false })
  txId: string;

  @Column({ type: 'float', nullable: false })
  amount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: false })
  asset: Asset;

  @ManyToOne(() => UserData, (userData) => userData.faucets, { nullable: false })
  userData: UserData;

  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Column({ nullable: false, default: FaucetStatus.CREATED })
  status: FaucetStatus;
}
