import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { CustodyAccountStatus } from '../enums/custody';
import { CustodyAccountAccess } from './custody-account-access.entity';

@Entity()
export class CustodyAccount extends IEntity {
  @Column({ length: 256 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Index()
  @ManyToOne(() => UserData, { nullable: false })
  owner: UserData;

  @Column({ type: 'int', default: 1 })
  requiredSignatures: number;

  @Column({ default: CustodyAccountStatus.ACTIVE })
  status: CustodyAccountStatus;

  @OneToMany(() => CustodyAccountAccess, (access) => access.account)
  accessGrants: CustodyAccountAccess[];

  /**
   * Whether this account belongs to the given user_data, as opposed to merely being reachable
   * through a grant. Distinct from the access level: a grantee can hold WRITE without owning
   * anything, and an owner can narrow themselves to READ while still owning it.
   */
  isOwnedBy(accountId: number): boolean {
    return this.owner.id === accountId;
  }
}
