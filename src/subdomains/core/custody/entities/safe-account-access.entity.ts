import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { SafeAccessLevel } from '../enums/custody';
import { SafeAccount } from './safe-account.entity';

@Entity()
@Index(['safeAccount', 'userData'], { unique: true })
export class SafeAccountAccess extends IEntity {
  @ManyToOne(() => SafeAccount, (safeAccount) => safeAccount.accessGrants, { nullable: false })
  safeAccount: SafeAccount;

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  @Column()
  accessLevel: SafeAccessLevel;
}
