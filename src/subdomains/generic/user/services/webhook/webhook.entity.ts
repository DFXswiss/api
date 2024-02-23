import { IEntity, UpdateResult } from 'src/shared/models/entity';
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
  lastTryDate: Date;

  @Column({ default: false })
  isComplete: boolean;

  // References
  @ManyToOne(() => User, { nullable: false })
  user: User;

  sentWebhook(result: boolean): UpdateResult<Webhook> {
    const update: Partial<Webhook> = {
      lastTryDate: new Date(),
      isComplete: result,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
