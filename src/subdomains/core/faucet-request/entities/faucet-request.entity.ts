import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { FaucetRequestStatus } from '../enums/faucet-request';

@Entity()
export class FaucetRequest extends IEntity {
  @Column({ nullable: false })
  txId: string;

  @Column({ type: 'float', nullable: false })
  amount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: false })
  asset: Asset;

  @ManyToOne(() => UserData, (userData) => userData.faucetRequests, { nullable: false })
  userData: UserData;

  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Column({ nullable: false, default: FaucetRequestStatus.CREATED })
  status: FaucetRequestStatus;

  complete(): UpdateResult<FaucetRequest> {
    const update: Partial<FaucetRequest> = {
      status: FaucetRequestStatus.COMPLETED,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
