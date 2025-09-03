import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, Generated, Index, ManyToOne } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';

export enum MergeReason {
  IDENT_DOCUMENT = 'IdentDocument',
  MAIL = 'Mail',
  IBAN = 'Iban',
}

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

  @Column({ length: 256, nullable: true })
  reason?: MergeReason;

  static create(master: UserData, slave: UserData, reason: MergeReason): AccountMerge {
    const entity = new AccountMerge();
    entity.master = master;
    entity.slave = slave;
    entity.reason = reason;

    entity.expiration = [MergeReason.IBAN, MergeReason.IDENT_DOCUMENT].includes(reason)
      ? Util.daysAfter(30)
      : Util.daysAfter(1);

    return entity;
  }

  complete(master: UserData, slave: UserData): UpdateResult<AccountMerge> {
    const update: Partial<AccountMerge> = {
      isCompleted: true,
      master,
      slave,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get isExpired(): boolean {
    return this.expiration < new Date();
  }
}
