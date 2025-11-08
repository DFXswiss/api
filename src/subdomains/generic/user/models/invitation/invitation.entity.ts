import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';

export enum InvitationCreator {
  ADVERTISER = 'Advertiser',
  RECRUIT = 'Recruit',
}

@Entity()
export class Invitation extends IEntity {
  @ManyToOne(() => UserData, { nullable: false })
  advertiser: UserData;

  @ManyToOne(() => UserData, { nullable: false })
  recruit: UserData;

  @Column({ length: 256, unique: true, nullable: false })
  code: string;

  @Column({ length: 256, nullable: false })
  label: string;

  @Column({ default: false })
  isConfirmed: boolean;

  @Column({ type: 'datetime2' })
  expiration: Date;

  @Column({ length: 256, nullable: false })
  creator?: InvitationCreator;

  get isUsed(): boolean {
    return !!this.recruit;
  }
}
