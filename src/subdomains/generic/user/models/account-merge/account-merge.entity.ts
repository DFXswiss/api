import { randomUUID } from 'crypto';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';

export enum MergeReason {
  IDENT_DOCUMENT = 'IdentDocument',
  MAIL = 'Mail',
  IBAN = 'Iban',
}

@Entity()
export class AccountMerge extends IEntity {
  @Index()
  @ManyToOne(() => UserData, { nullable: false })
  master: UserData;

  @Index()
  @ManyToOne(() => UserData, { nullable: false })
  slave: UserData;

  @Column()
  @Index({ unique: true })
  code: string;

  @Column({ default: false })
  isCompleted: boolean;

  @Column({ type: 'timestamp' })
  expiration: Date;

  @Column({ type: 'timestamp', nullable: true })
  processingStartedAt?: Date;

  @Column({ length: 256, nullable: true })
  reason?: MergeReason;

  static create(master: UserData, slave: UserData, reason: MergeReason): AccountMerge {
    const entity = new AccountMerge();
    entity.master = master;
    entity.slave = slave;
    entity.reason = reason;
    entity.code = randomUUID();

    entity.expiration = [MergeReason.IBAN, MergeReason.IDENT_DOCUMENT].includes(reason)
      ? Util.daysAfter(30)
      : Util.daysAfter(1);

    return entity;
  }

  startProcessing(): UpdateResult<AccountMerge> {
    const update: Partial<AccountMerge> = { processingStartedAt: new Date() };

    Object.assign(this, update);

    return [this.id, update];
  }

  stopProcessing(): UpdateResult<AccountMerge> {
    const update: Partial<AccountMerge> = { processingStartedAt: null };

    Object.assign(this, update);

    return [this.id, update];
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

  // user has confirmed the merge and the backend is still processing it (re-parenting, KYC follow-up)
  get isProcessing(): boolean {
    return !this.isCompleted && this.processingStartedAt != null && !this.isExpired;
  }
}
