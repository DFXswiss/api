import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { CustodyAccessLevel } from '../enums/custody';
import { CustodyAccount } from './custody-account.entity';

@Entity()
// One active grant per (account, userData); historical rows stay with active = false.
@Index((a: CustodyAccountAccess) => [a.account, a.userData], { unique: true, where: '"active" = true' })
export class CustodyAccountAccess extends IEntity {
  @Index()
  @ManyToOne(() => CustodyAccount, (custodyAccount) => custodyAccount.accessGrants, { nullable: false })
  account: CustodyAccount;

  @Index()
  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  @Column()
  accessLevel: CustodyAccessLevel;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deactivatedAt?: Date;
}
