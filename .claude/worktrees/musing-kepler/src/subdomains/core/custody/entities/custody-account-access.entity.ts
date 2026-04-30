import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CustodyAccessLevel } from '../enums/custody';
import { CustodyAccount } from './custody-account.entity';

@Entity()
@Index((a: CustodyAccountAccess) => [a.account, a.userData], { unique: true })
export class CustodyAccountAccess extends IEntity {
  @ManyToOne(() => CustodyAccount, (custodyAccount) => custodyAccount.accessGrants, { nullable: false })
  account: CustodyAccount;

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  @Column()
  accessLevel: CustodyAccessLevel;
}
