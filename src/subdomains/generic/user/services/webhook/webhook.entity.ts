import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { User } from '../../models/user/user.entity';
import { WebhookType } from './dto/webhook.dto';

@Entity()
export class Webhook extends IEntity {
  @Column({ length: 256 })
  type: WebhookType;

  @Column({ length: 'MAX' })
  data: string;

  @Column({ length: 256, nullable: true })
  reason: string;

  @Column({ type: 'datetime2', nullable: true })
  sentDate: Date;

  // References
  @ManyToOne(() => UserData, { nullable: true })
  user: User;

  @ManyToOne(() => UserData, { nullable: true })
  userData: UserData;

  confirmSentDate(): UpdateResult<Webhook> {
    const update: Partial<Webhook> = {
      sentDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
