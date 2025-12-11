import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { SafeAccountStatus } from '../enums/custody';
import { SafeAccountAccess } from './safe-account-access.entity';

@Entity()
export class SafeAccount extends IEntity {
  @Column({ length: 256 })
  title: string;

  @Column({ length: 'MAX', nullable: true })
  description?: string;

  @ManyToOne(() => UserData, { nullable: false })
  owner: UserData;

  @Column({ type: 'int', default: 1 })
  requiredSignatures: number;

  @Column({ default: SafeAccountStatus.ACTIVE })
  status: SafeAccountStatus;

  @OneToMany(() => SafeAccountAccess, (access) => access.safeAccount)
  accessGrants: SafeAccountAccess[];

  // Relationships to User, CustodyBalance, CustodyOrder will be added
  // when those entities are updated
}
