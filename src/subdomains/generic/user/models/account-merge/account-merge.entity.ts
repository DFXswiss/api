import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, Generated, Index, ManyToOne } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';

@Entity()
export class AccountMerge extends IEntity {
  @ManyToOne(() => UserData, { nullable: false })
  master: UserData;

  @ManyToOne(() => UserData, { nullable: false })
  slave: UserData;

  @Column()
  @Generated('uuid')
  @Index({ unique: true })
  code: string;

  @Column({ default: false })
  isCompleted: boolean;

  @Column({ type: 'datetime2' })
  expiration: Date;

  static create(master: UserData, slave: UserData): AccountMerge {
    const entity = new AccountMerge();
    entity.master = master;
    entity.slave = slave;

    entity.expiration = Util.daysAfter(1);

    return entity;
  }

  complete(): this {
    this.isCompleted = true;

    return this;
  }

  get isExpired(): boolean {
    return this.expiration < new Date();
  }
}
