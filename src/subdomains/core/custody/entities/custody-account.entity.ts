import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { CustodyAccountStatus } from '../enums/custody';
import { CustodyAccountAccess } from './custody-account-access.entity';

@Entity()
export class CustodyAccount extends IEntity {
  @Column({ length: 256 })
  title: string;

  @Column({ length: 'MAX', nullable: true })
  description?: string;

  @ManyToOne(() => UserData, { nullable: false })
  owner: UserData;

  @Column({ type: 'int', default: 1 })
  requiredSignatures: number;

  @Column({ default: CustodyAccountStatus.ACTIVE })
  status: CustodyAccountStatus;

  @OneToMany(() => CustodyAccountAccess, (access) => access.custodyAccount)
  accessGrants: CustodyAccountAccess[];
}
